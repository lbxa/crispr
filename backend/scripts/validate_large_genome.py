"""Measure bounded-memory VCF scans in fresh processes without logging genome data.

Local acceptance example (no upload):
  .venv/bin/python -m scripts.validate_large_genome --file data/example.vcf --file data/example.vcf.gz

Synthetic acceptance (the default matches the local HG001 VCF's byte length):
  .venv/bin/python -m scripts.validate_large_genome --size-bytes 2065554427 --encoding plain --encoding gzip
"""

import argparse
import gzip
import hashlib
import json
import resource
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from crispr_backend.vcf import scan_vcf

HG001_BYTES = 2_065_554_427
MIB = 1024 * 1024
SENTINEL = ("1", 1000, "A", "G")
HEADER = (
    b"##fileformat=VCFv4.2\n"
    b"##reference=GRCh38\n"
    b"##source=crispr-synthetic-validation-not-patient-data\n"
    b'##INFO=<ID=SYNTHETIC,Number=1,Type=String,Description="Synthetic benchmark padding">\n'
    b"#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHARNESS_SYNTHETIC\n"
)
SENTINEL_RECORD = b"chr1\t1000\t.\tA\tG\t.\tPASS\t.\tGT\t0|1\n"


@dataclass(frozen=True)
class Measurement:
    compressed: bool
    source_bytes: int
    uncompressed_bytes: int
    records_scanned: int
    variants_checked: int
    retained_calls: int
    calls_sha256: str
    elapsed_seconds: float
    peak_rss_bytes: int

    @classmethod
    def from_json(cls, text: str) -> "Measurement":
        payload = json.loads(text)
        if not isinstance(payload, dict) or not isinstance(payload.get("compressed"), bool):
            raise ValueError("Scanner subprocess returned an invalid measurement")
        integer_fields = (
            "source_bytes",
            "uncompressed_bytes",
            "records_scanned",
            "variants_checked",
            "retained_calls",
            "peak_rss_bytes",
        )
        if any(type(payload.get(key)) is not int or payload[key] < 0 for key in integer_fields):
            raise ValueError("Scanner subprocess returned invalid counters")
        if (
            not isinstance(payload.get("elapsed_seconds"), (float, int))
            or payload["elapsed_seconds"] < 0
            or not isinstance(payload.get("calls_sha256"), str)
            or len(payload["calls_sha256"]) != 64
        ):
            raise ValueError("Scanner subprocess returned invalid timing or integrity data")
        return cls(**payload)


def write_synthetic(path: Path, size_bytes: int) -> int:
    """Write valid single-sample records in bounded blocks; return the record count."""
    remaining = size_bytes - len(HEADER) - len(SENTINEL_RECORD)
    if remaining < 3:
        raise ValueError("Synthetic size must leave room for the VCF header, sentinel, and trailing whitespace")
    records = 1
    buffer = bytearray()
    with path.open("wb") as destination:
        destination.write(HEADER)
        destination.write(SENTINEL_RECORD)
        while True:
            record = (
                f"chr2\t{1_000_000 + records}\t.\tA\tG\t.\tPASS\tSYNTHETIC={records:010d}{'ACGT' * 96}\tGT\t0/1\n"
            ).encode("ascii")
            if len(record) + 3 > remaining:
                break
            buffer.extend(record)
            remaining -= len(record)
            records += 1
            if len(buffer) >= MIB:
                destination.write(buffer)
                buffer.clear()
        destination.write(buffer)
        destination.write(b"\n" * remaining)
    if path.stat().st_size != size_bytes:
        raise RuntimeError("Synthetic fixture did not reach the requested byte length")
    return records


def relevant_loci(reference_db: Path | None) -> set[tuple[str, int, str, str]]:
    if reference_db is None:
        return {SENTINEL}
    # Read only: benchmark execution must never create or migrate a reference DB.
    with sqlite3.connect(f"{reference_db.resolve().as_uri()}?mode=ro", uri=True) as connection:
        return {
            (str(chrom), int(pos), str(ref), str(alt))
            for chrom, pos, ref, alt in connection.execute("SELECT chrom, pos, ref, alt FROM variants")
        }


def scan_worker(path: Path, reference_db: Path | None) -> Measurement:
    started = time.monotonic()
    loci = relevant_loci(reference_db)
    with path.open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
        source.seek(0)
        result = scan_vcf(source, relevant_loci=loci, compressed=compressed)
    fingerprint = hashlib.sha256()
    for call in result.calls:
        fingerprint.update(json.dumps(asdict(call), sort_keys=True, separators=(",", ":")).encode("utf-8"))
        fingerprint.update(b"\n")
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return Measurement(
        compressed=compressed,
        source_bytes=path.stat().st_size,
        uncompressed_bytes=result.uncompressed_bytes,
        records_scanned=result.records_scanned,
        variants_checked=result.variants_checked,
        retained_calls=len(result.calls),
        calls_sha256=fingerprint.hexdigest(),
        elapsed_seconds=round(time.monotonic() - started, 4),
        peak_rss_bytes=int(peak_rss if sys.platform == "darwin" else peak_rss * 1024),
    )


def isolated_scan(path: Path, reference_db: Path | None, timeout_seconds: int) -> Measurement:
    command = [sys.executable, "-m", "scripts.validate_large_genome", "--worker", str(path)]
    if reference_db is not None:
        command.extend(["--reference-db", str(reference_db.resolve())])
    completed = subprocess.run(
        command,
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        # Exceptions can contain source data. Expose only the exit code to the caller.
        raise RuntimeError(f"Scanner subprocess failed with exit code {completed.returncode}")
    return Measurement.from_json(completed.stdout)


def encode_fixture(source: Path, destination: Path, encoding: str) -> None:
    if encoding == "gzip":
        with (
            source.open("rb") as plain,
            gzip.GzipFile(filename=str(destination), mode="wb", compresslevel=1, mtime=0) as compressed,
        ):
            shutil.copyfileobj(plain, compressed, length=MIB)
    elif encoding == "bgzf":
        # Already installed by requirements-etl; production parsing requires no htslib.
        import pysam

        with source.open("rb") as plain, pysam.BGZFile(str(destination), "wb", index=None) as compressed:
            shutil.copyfileobj(plain, compressed, length=MIB)
    else:
        raise ValueError("Expected gzip or bgzf encoding")


def assert_parity(left: Measurement, right: Measurement) -> None:
    names = ("uncompressed_bytes", "records_scanned", "variants_checked", "retained_calls", "calls_sha256")
    if any(getattr(left, name) != getattr(right, name) for name in names):
        raise RuntimeError("Uncompressed VCF, gzip, and BGZF results differ")


def validate_resumable_upload(
    url: str,
    source: Path,
    expected: Measurement,
    timeout_seconds: int,
    *,
    pause_after_first_chunk: int = 0,
    checkpoint_path: Path | None = None,
) -> dict:
    """Exercise the real TUS boundary, including an interrupted transfer."""
    import base64

    import requests

    origin = urlsplit(url)
    file_format = "vcf_gzip" if expected.compressed else "vcf"
    started = time.monotonic()
    with requests.Session() as client:
        client.trust_env = False

        def request(method: str, path: str, *, allowed: tuple[int, ...] = (200,), **kwargs) -> requests.Response:
            absolute = urljoin(url.rstrip("/") + "/", path)
            target = urlsplit(absolute)
            if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
                raise RuntimeError("Upload endpoint escaped the explicitly selected origin")
            try:
                response = client.request(
                    method, absolute, timeout=kwargs.pop("timeout", 60), allow_redirects=False, **kwargs
                )
            except requests.RequestException as error:
                raise RuntimeError("Upload acceptance transport failed") from error
            if response.status_code not in allowed:
                # Never emit response bodies, capabilities, or genome contents on failure.
                raise RuntimeError(f"Upload acceptance {method} returned HTTP {response.status_code}")
            return response

        created = request(
            "POST", "/uploads", allowed=(201,), json={"size_bytes": expected.source_bytes, "format": file_format}
        ).json()
        if (
            not isinstance(created, dict)
            or not all(isinstance(created.get(key), str) and created[key] for key in ("id", "token", "upload_endpoint"))
            or type(created.get("chunk_size")) is not int
            or not 0 < created["chunk_size"] <= 16 * MIB
        ):
            raise RuntimeError("Upload creation returned an invalid session contract")
        session_id = created["id"]
        auth = {"Authorization": f"Bearer {created['token']}"}
        tus = {**auth, "Tus-Resumable": "1.0.0"}
        metadata = ",".join(
            f"{key} {base64.b64encode(value.encode()).decode('ascii')}"
            for key, value in (("session_id", session_id), ("format", file_format))
        )
        initialized = request(
            "POST",
            created["upload_endpoint"],
            allowed=(201,),
            headers={**tus, "Upload-Length": str(expected.source_bytes), "Upload-Metadata": metadata},
        )
        location = initialized.headers.get("Location")
        if not location:
            raise RuntimeError("TUS creation did not return a resource Location")
        # Resolve relative locations against the creation endpoint, as required by HTTP.
        location = urljoin(initialized.url, location)
        status_path = f"/uploads/{session_id}"
        request("GET", status_path, allowed=(401, 403))
        offset = 0
        chunks = 0
        digest = hashlib.sha256()
        with source.open("rb") as data:
            while chunk := data.read(created["chunk_size"]):
                uploaded = request(
                    "PATCH",
                    location,
                    allowed=(204,),
                    headers={**tus, "Upload-Offset": str(offset), "Content-Type": "application/offset+octet-stream"},
                    data=chunk,
                )
                offset += len(chunk)
                digest.update(chunk)
                chunks += 1
                if uploaded.headers.get("Upload-Offset") != str(offset):
                    raise RuntimeError("TUS acknowledgement did not match the transmitted byte count")
                if chunks == 1:
                    if checkpoint_path is not None:
                        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
                        checkpoint_path.write_text(
                            json.dumps({"phase": "first_chunk_accepted", "bytes": offset}) + "\n"
                        )
                    if pause_after_first_chunk:
                        print(
                            f"First chunk accepted; pausing {pause_after_first_chunk} seconds for controlled restart.",
                            file=sys.stderr,
                            flush=True,
                        )
                        time.sleep(pause_after_first_chunk)
                    # Discard the connection and resume from server truth, as after a network loss.
                    head = request("HEAD", location, headers={**tus, "Connection": "close"})
                    if head.headers.get("Upload-Offset") != str(offset):
                        raise RuntimeError("Interrupted upload did not resume at its acknowledged offset")
                    request(
                        "PATCH",
                        location,
                        allowed=(409,),
                        headers={**tus, "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream"},
                        data=b"stale-attempt",
                    )
                    unchanged = request("HEAD", location, headers=tus)
                    if unchanged.headers.get("Upload-Offset") != str(offset):
                        raise RuntimeError("Rejected stale-offset upload changed the stored data")
                    if offset < expected.source_bytes:
                        request("POST", status_path + "/complete", allowed=(409,), headers=auth)
        request("POST", status_path + "/complete", allowed=(202,), headers=auth)
        request("POST", status_path + "/complete", allowed=(202,), headers=auth)
        health_latencies: list[float] = []
        processing_health_checks = 0
        while True:
            status = request("GET", status_path, headers=auth).json()
            if not isinstance(status, dict) or status.get("id") != session_id:
                raise RuntimeError("Analysis status returned an invalid session contract")
            state = status.get("status")
            if state == "complete":
                break
            if state not in ("queued", "processing"):
                raise RuntimeError("Resumed upload did not complete successfully")
            health_started = time.monotonic()
            health = request("GET", "/health", timeout=2).json()
            health_elapsed = time.monotonic() - health_started
            if health != {"status": "ok"} or health_elapsed > 2:
                raise RuntimeError("API health was not responsive while analysis was outstanding")
            health_latencies.append(health_elapsed)
            if state == "processing":
                processing_health_checks += 1
            if time.monotonic() - started > timeout_seconds:
                raise RuntimeError("Background analysis exceeded the acceptance deadline")
            time.sleep(0.25)
        expected_counters = {
            "size_bytes": expected.source_bytes,
            "uploaded_bytes": expected.source_bytes,
            "records_scanned": expected.records_scanned,
            "variants_checked": expected.variants_checked,
            "uncompressed_bytes": expected.uncompressed_bytes,
        }
        if any(status.get(key) != value for key, value in expected_counters.items()):
            raise RuntimeError("Background analysis counters differ from the local streaming scan")
        if status.get("sha256") != digest.hexdigest():
            raise RuntimeError("Stored artifact SHA-256 differs from the transmitted bytes")
        report = status.get("report")
        if not isinstance(report, dict) or not isinstance(report.get("genome"), dict):
            raise RuntimeError("Background analysis did not return a report")
        if report["genome"].get("variants_checked") != expected.variants_checked:
            raise RuntimeError("Report does not account for all observed variants")
        return {
            "status": "passed",
            "chunks": chunks,
            "resumed_after_bytes": min(created["chunk_size"], expected.source_bytes),
            "stale_offset_rejected": True,
            "unauthenticated_status_rejected": True,
            "completion_replayed": True,
            "checkpoint_pause_seconds": pause_after_first_chunk,
            "health_checks_while_outstanding": len(health_latencies),
            "health_checks_while_processing": processing_health_checks,
            "max_health_latency_seconds": round(max(health_latencies, default=0), 4),
            "sha256": digest.hexdigest(),
            "elapsed_seconds": round(time.monotonic() - started, 4),
            **expected_counters,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--file",
        action="append",
        type=Path,
        help="Existing copies of the same VCF to scan in place; no upload",
    )
    parser.add_argument(
        "--reference-db", type=Path, help="Read-only reference SQLite DB; otherwise use a synthetic sentinel locus"
    )
    parser.add_argument(
        "--size-bytes", type=int, default=HG001_BYTES, help="Synthetic VCF size, default matches the local HG001"
    )
    parser.add_argument("--baseline-bytes", type=int, default=32 * MIB)
    parser.add_argument(
        "--encoding",
        action="append",
        choices=("plain", "gzip", "bgzf"),
        help="Synthetic encodings (default plain,gzip)",
    )
    parser.add_argument("--max-rss-mib", type=int, default=512)
    parser.add_argument("--max-rss-growth-mib", type=int, default=128)
    parser.add_argument("--timeout-seconds", type=int, default=2400, help="Per-scan subprocess deadline")
    parser.add_argument("--url", help="Optional API origin for TUS resume/job acceptance; requires the full stack")
    parser.add_argument("--upload-encoding", choices=("plain", "gzip", "bgzf"), default="plain")
    parser.add_argument(
        "--pause-after-first-chunk", type=int, default=0, help="Synthetic HTTP restart checkpoint, 0–30 seconds"
    )
    parser.add_argument(
        "--checkpoint-path", type=Path, help="Optional aggregate JSON checkpoint for controlled restart coordination"
    )
    parser.add_argument("--output", type=Path, help="Optional JSON metrics destination; contains no genome contents")
    parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker is not None:
        print(json.dumps(asdict(scan_worker(args.worker, args.reference_db))))
        return 0
    if min(args.size_bytes, args.baseline_bytes, args.max_rss_mib, args.max_rss_growth_mib, args.timeout_seconds) <= 0:
        parser.error("Sizes, memory limits, and deadlines must be positive")
    if args.reference_db is not None and not args.reference_db.is_file():
        parser.error("Reference database does not exist")
    if args.file and any(not path.is_file() for path in args.file):
        parser.error("An input file does not exist")
    if args.url and args.file:
        parser.error("HTTP acceptance uses generated data; existing --file inputs are only scanned in place")
    if args.url and urlsplit(args.url).scheme not in ("http", "https"):
        parser.error("HTTP acceptance requires an explicit HTTP(S) origin")
    if not 0 <= args.pause_after_first_chunk <= 30:
        parser.error("The restart checkpoint pause must be between 0 and 30 seconds")
    if (args.pause_after_first_chunk or args.checkpoint_path) and not args.url:
        parser.error("Restart checkpoints require synthetic HTTP acceptance with --url")
    if args.checkpoint_path is not None:
        args.checkpoint_path.unlink(missing_ok=True)

    measurements: list[Measurement] = []
    upload_results: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="crispr-vcf-validation-") as directory:
        work = Path(directory)
        baseline_path = work / "baseline.vcf"
        baseline_records = write_synthetic(baseline_path, args.baseline_bytes)
        baseline = isolated_scan(baseline_path, None, args.timeout_seconds)
        if (
            baseline.records_scanned != baseline_records
            or baseline.variants_checked != baseline_records
            or baseline.retained_calls != 1
        ):
            raise RuntimeError("Synthetic baseline counters or sentinel retention are incorrect")
        if args.file:
            for path in args.file:
                measurements.append(isolated_scan(path.resolve(), args.reference_db, args.timeout_seconds))
        else:
            source = work / "synthetic.vcf"
            expected_records = write_synthetic(source, args.size_bytes)
            for encoding in args.encoding or ("plain", "gzip"):
                path = source
                if encoding != "plain":
                    path = work / f"synthetic.{encoding}"
                    encode_fixture(source, path, encoding)
                measured = isolated_scan(path, None, args.timeout_seconds)
                if (
                    measured.records_scanned != expected_records
                    or measured.variants_checked != expected_records
                    or measured.retained_calls != 1
                ):
                    raise RuntimeError("Synthetic fixture counters or sentinel retention are incorrect")
                measurements.append(measured)
                if path != source:
                    path.unlink()
        for measured in measurements:
            if measured.peak_rss_bytes > args.max_rss_mib * MIB:
                raise RuntimeError("Peak scanner memory exceeded the configured limit")
            if measured.peak_rss_bytes - baseline.peak_rss_bytes > args.max_rss_growth_mib * MIB:
                raise RuntimeError("Scanner memory grew with file size beyond the configured limit")
            assert_parity(measurements[0], measured)
        if args.url:
            upload_source = work / "synthetic.vcf"
            if args.upload_encoding != "plain":
                upload_source = work / f"upload.{args.upload_encoding}"
                encode_fixture(work / "synthetic.vcf", upload_source, args.upload_encoding)
            upload_measurement = isolated_scan(upload_source, None, args.timeout_seconds)
            upload_results.append(
                validate_resumable_upload(
                    args.url,
                    upload_source,
                    upload_measurement,
                    args.timeout_seconds,
                    pause_after_first_chunk=args.pause_after_first_chunk,
                    checkpoint_path=args.checkpoint_path,
                )
            )

    result = {
        "status": "passed",
        "mode": "local-files" if args.file else "synthetic",
        "reference": "reference-database" if args.file and args.reference_db else "synthetic-sentinel-only",
        "max_rss_bytes": args.max_rss_mib * MIB,
        "max_rss_growth_bytes": args.max_rss_growth_mib * MIB,
        "baseline": asdict(baseline),
        "scans": [asdict(measured) for measured in measurements],
        "uploads": upload_results,
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.output is not None:
        # Runtime metrics serialization, never source or documentation generation.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1) from None
