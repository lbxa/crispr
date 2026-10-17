"""Single-concurrency, restartable genome analysis worker.

Run separately from uvicorn: ``python -m crispr_backend.uploads.worker``.
No web request waits for a scan, and no uploaded genome is loaded as one string.
"""

import argparse
import hashlib
import json
import logging
import resource
import signal
import sys
import threading
import time

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.uploads.service import UploadService
from crispr_backend.uploads.settings import UploadSettings
from crispr_backend.uploads.store import UploadError
from crispr_backend.vcf import VcfCancelled, VcfProgress, VcfValidationError, scan_vcf

logger = logging.getLogger(__name__)


class AnalysisWorker:
    """Owns the lease and cancellation lifetime of one analysis at a time."""

    def __init__(self, service: UploadService, analyzer: Analyzer, stop: threading.Event | None = None):
        self.service = service
        self.analyzer = analyzer
        self.stop = stop or threading.Event()

    def run_once(self) -> bool:
        self.service.reconcile()
        session = self.service.repository.claim_next_job()
        if session is None:
            return False
        self.process(session)
        return True

    def process(self, session: dict) -> None:
        repository = self.service.repository
        upload_id, lease_id = session["id"], session["lease_id"]
        started = time.monotonic()
        done = threading.Event()
        lease_lost = threading.Event()
        progress_lock = threading.Lock()
        progress = {"records_scanned": 0, "variants_checked": 0, "retained_variants": 0, "uncompressed_bytes": 0}

        def record_progress(value: VcfProgress):
            with progress_lock:
                progress.update(
                    records_scanned=value.records_scanned,
                    variants_checked=value.variants_checked,
                    retained_variants=value.retained_calls,
                    uncompressed_bytes=value.uncompressed_bytes,
                )

        def heartbeat():
            interval = min(5.0, self.service.settings.lease_seconds / 3)
            while not done.wait(interval):
                try:
                    with progress_lock:
                        counters = dict(progress)
                    if not repository.heartbeat(upload_id, lease_id, counters):
                        lease_lost.set()
                        return
                except Exception:
                    # A failed heartbeat must stop work before its lease can be
                    # claimed elsewhere. Do not keep processing speculatively.
                    lease_lost.set()
                    logger.error(json.dumps({"event": "analysis.heartbeat_failed", "upload_id": upload_id}))
                    return

        def cancelled() -> bool:
            return self.stop.is_set() or lease_lost.is_set()

        heartbeat_thread = threading.Thread(target=heartbeat, name=f"upload-lease-{upload_id}", daemon=True)
        heartbeat_thread.start()
        logger.info(json.dumps({"event": "analysis.started", "upload_id": upload_id, "attempt": session["attempts"]}))
        report = None
        digest = None
        failure = None
        interrupted = False
        try:
            with self.service.tus.open_complete(session) as source:
                checksum = hashlib.sha256()
                while chunk := source.read(1024 * 1024):
                    if cancelled():
                        raise VcfCancelled("VCF scan cancelled")
                    checksum.update(chunk)
                digest = checksum.hexdigest()
                source.seek(0)
                result = scan_vcf(
                    source,
                    relevant_loci=self.analyzer.variants.by_locus,
                    compressed=session["format"] == "vcf_gzip",
                    on_progress=record_progress,
                    cancelled=cancelled,
                )
            if cancelled():
                raise VcfCancelled("VCF scan cancelled")
            report = self.analyzer.analyze(
                list(result.calls),
                "",
                None,
                False,
                variants_checked=result.variants_checked,
                model_profile=result.model_profile,
            )
        except VcfCancelled:
            interrupted = True
        except VcfValidationError:
            failure = UploadError(
                "INVALID_VCF",
                "The file is not a supported single-sample GRCh38 VCF, or exceeds processing limits.",
                422,
            )
        except UploadError as error:
            failure = error
        except OSError:
            failure = UploadError(
                "ANALYSIS_STORAGE", "The uploaded file could not be read. Try the analysis again.", 503, retryable=True
            )
        except Exception:
            # Report only a stable code; exception messages can include genome
            # records, sample names or model responses and must not enter logs.
            failure = UploadError(
                "ANALYSIS_FAILED", "Analysis could not finish. Try the analysis again.", 503, retryable=True
            )
        finally:
            done.set()
            heartbeat_thread.join(timeout=10)
        if interrupted or cancelled():
            repository.release_interrupted(upload_id, lease_id)
            logger.info(json.dumps({"event": "analysis.interrupted", "upload_id": upload_id}))
            return
        with progress_lock:
            counters = dict(progress)
        if not repository.heartbeat(upload_id, lease_id, counters):
            repository.release_interrupted(upload_id, lease_id)
            return
        committed = repository.finish(upload_id, lease_id, report=report, sha256=digest, error=failure)
        logger.info(
            json.dumps(
                {
                    "event": "analysis.failed" if failure else "analysis.completed",
                    "upload_id": upload_id,
                    "error_code": failure.code if failure else None,
                    "committed": committed,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "worker_peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                    * (1 if sys.platform == "darwin" else 1024),
                    **counters,
                }
            )
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Process durable genome analysis jobs, one at a time.")
    parser.add_argument("--once", action="store_true", help="Process at most one job, then exit.")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    service = UploadService(UploadSettings.from_env())
    with db.session() as connection:
        analyzer = Analyzer(connection)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _signal, _frame: stop.set())
    worker = AnalysisWorker(service, analyzer, stop)
    logger.info(json.dumps({"event": "analysis.worker_started", "max_concurrency": 1}))

    def maintain_uploads():
        # Maintenance continues while a scan occupies the main worker thread:
        # concurrent uploads still receive progress-based TTL extension and
        # canceled uploads can release their disk reservation promptly.
        while not stop.wait(5):
            try:
                service.reconcile()
            except Exception:
                logger.error(json.dumps({"event": "analysis.maintenance_failed"}))

    maintenance_thread = threading.Thread(target=maintain_uploads, name="upload-maintenance", daemon=True)
    if not arguments.once:
        maintenance_thread.start()
    try:
        while not stop.is_set():
            try:
                worked = worker.run_once()
            except Exception:
                logger.error(json.dumps({"event": "analysis.worker_iteration_failed"}))
                worked = False
            if arguments.once:
                break
            if not worked:
                stop.wait(service.settings.worker_poll_seconds)
    finally:
        stop.set()
        if maintenance_thread.is_alive():
            maintenance_thread.join(timeout=10)
    logger.info(json.dumps({"event": "analysis.worker_stopped"}))


if __name__ == "__main__":
    main()
