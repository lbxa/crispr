"""Upload use cases coordinating resource policy, persistence and tusd."""

import json
import logging
import shutil
import time

from crispr_backend.uploads.settings import UploadSettings
from crispr_backend.uploads.store import UploadError, UploadFormat, UploadRepository, timestamp
from crispr_backend.uploads.tus import TusStore

logger = logging.getLogger(__name__)


def public_report(report: dict) -> dict:
    """Expose the summary and explicit viewer map, without symptoms or edit plans."""
    result = {
        "conclusion": {key: report["conclusion"][key] for key in ("status", "label")},
        "summary": {"text": report["summary"]["text"]},
        "genome": {key: report["genome"][key] for key in ("variants_checked", "panel_genes")},
        "findings": [{key: finding[key] for key in ("tier", "gene", "disease")} for finding in report["findings"]],
        "disclaimer": report["disclaimer"],
    }
    if "model_profile" in report["genome"]:
        result["genome"]["model_profile"] = report["genome"]["model_profile"]
    # Older completed jobs have no map; keep them readable and request reanalysis in the UI.
    if "genome_view" in report:
        result["genome_view"] = report["genome_view"]
    if "body_map" in report:
        result["body_map"] = report["body_map"]
    return result


class UploadService:
    def __init__(self, settings: UploadSettings):
        self.settings = settings
        self.repository = UploadRepository(settings)
        self.tus = TusStore(settings)

    def create(self, size_bytes: int, format: UploadFormat, *, source_key: str | None = None) -> dict:
        if size_bytes < 1 or size_bytes > self.settings.max_upload_bytes:
            raise UploadError("UPLOAD_SIZE", "The genome file exceeds this server's upload limit.", 413)
        if format not in ("vcf", "vcf_gzip"):
            raise UploadError("UPLOAD_FORMAT", "Select a .vcf or .vcf.gz genome file.", 422)
        session, token = self.repository.reserve(
            size_bytes,
            format,
            available_bytes=shutil.disk_usage(self.settings.directory).free,
            source_key=source_key,
        )
        logger.info(json.dumps({"event": "upload.reserved", "upload_id": session["id"], "size_bytes": size_bytes}))
        return {
            "id": session["id"],
            "token": token,
            "status": "uploading",
            "upload_endpoint": self.settings.public_url,
            "chunk_size": self.settings.chunk_size,
            "max_upload_bytes": self.settings.max_upload_bytes,
            "expires_at": timestamp(session["expires_at"]),
        }

    def authenticate(self, token: str, upload_id: str | None = None) -> dict:
        session = self.repository.authenticate(token, upload_id)
        if session["status"] == "uploading" and session["expires_at"] <= time.time():
            # A slow first PATCH can outlast its empty reservation while the
            # worker is busy. Observe newly stored bytes before expiring it.
            self.view(session)
            refreshed = self.repository.get(session["id"])
            if refreshed is None:
                raise UploadError("UPLOAD_UNAUTHORIZED", "A valid upload token is required.", 401)
            session = refreshed
        if session["expires_at"] <= time.time() or session["status"] == "expired":
            raise UploadError("UPLOAD_EXPIRED", "This upload has expired. Upload the file again.", 410)
        return session

    def view(self, session: dict) -> dict:
        if session["status"] == "uploading":
            offset = self.tus.offset(session["id"])
            if offset > session["size_bytes"]:
                raise UploadError("UPLOAD_INVALID_STORAGE", "The stored upload exceeds its reserved size.", 422)
            if offset != session["uploaded_bytes"]:
                session = self.repository.record_uploaded_bytes(session["id"], offset)
        result = {
            key: session[key]
            for key in (
                "id",
                "status",
                "size_bytes",
                "uploaded_bytes",
                "records_scanned",
                "variants_checked",
                "retained_variants",
                "uncompressed_bytes",
                "sha256",
                "attempts",
            )
        }
        result.update(
            {
                "created_at": timestamp(session["created_at"]),
                "updated_at": timestamp(session["updated_at"]),
                "expires_at": timestamp(session["expires_at"]),
                "report": public_report(json.loads(session["report_json"])) if session["report_json"] else None,
                "error": {
                    "code": session["error_code"],
                    "message": session["error_message"],
                    "retryable": bool(session["retryable"] and session["attempts"] < self.settings.max_attempts),
                }
                if session["error_code"]
                else None,
            }
        )
        return result

    def complete(self, session: dict) -> dict:
        if session["status"] in ("queued", "processing", "complete", "failed"):
            return self.view(session)
        if session["status"] != "uploading":
            raise UploadError("UPLOAD_CANCELED", "This upload is no longer active.", 409)
        self.tus.verify_complete(session)
        queued = self.repository.enqueue_completed_upload(session["id"])
        logger.info(json.dumps({"event": "upload.queued", "upload_id": session["id"]}))
        return self.view(queued)

    def retry(self, session: dict) -> dict:
        if not self.repository.require_retryable(session):
            return self.view(session)
        self.tus.verify_complete(session)
        queued = self.repository.retry_failed(session["id"])
        logger.info(json.dumps({"event": "upload.retry_requested", "upload_id": session["id"]}))
        return self.view(queued)

    def cancel(self, session: dict) -> dict:
        canceled = self.repository.cancel(session["id"])
        logger.info(json.dumps({"event": "upload.canceled", "upload_id": session["id"]}))
        return self.view(canceled)

    def reconcile(self) -> None:
        """Recover missed nonblocking tus hooks and finish safe expired cleanup."""
        for session in self.repository.awaiting_completion():
            try:
                # The first stored bytes turn a short empty reservation into a
                # resumable transfer with the full retention window.
                self.view(session)
                self.complete(session)
            except UploadError as error:
                if error.code != "UPLOAD_INCOMPLETE":
                    logger.warning(
                        json.dumps(
                            {"event": "upload.reconcile_failed", "upload_id": session["id"], "error_code": error.code}
                        )
                    )
        # Reconcile progress first: expiration must not discard a first PATCH
        # that has written bytes since the last reservation check.
        for session in self.repository.expire_and_list_cleanup():
            if self.tus.terminate(session["id"]):
                self.repository.mark_purged(session["id"])
                if not session["purged"]:
                    logger.info(json.dumps({"event": "upload.purged", "upload_id": session["id"]}))
