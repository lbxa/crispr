"""Validate existing SQLite genome BLOBs in place, without exporting genome files."""

import argparse
import io
import json
import resource
import sqlite3
import sys
import time
from collections.abc import Buffer
from contextlib import closing
from dataclasses import asdict, dataclass
from pathlib import Path

from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.db import db_path
from crispr_backend.vcf import read_calls_gz, scan_vcf

PARITY_LIMIT_BYTES = 20 * 1024 * 1024
BLOB_READ_BYTES = 64 * 1024


class DatabaseValidationError(RuntimeError):
    """An acceptance invariant failed; messages contain no genome data."""


class SqliteBlobReader(io.RawIOBase):
    """Own a SQLite BLOB handle and expose bounded reads to standard buffered IO."""

    def __init__(self, blob: sqlite3.Blob):
        super().__init__()
        self._blob = blob

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def readinto(self, buffer: Buffer) -> int:
        target = memoryview(buffer).cast("B")
        chunk = self._blob.read(min(len(target), BLOB_READ_BYTES))
        target[: len(chunk)] = chunk
        return len(chunk)

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        self._blob.seek(offset, whence)
        return self._blob.tell()

    def tell(self) -> int:
        return self._blob.tell()

    def close(self) -> None:
        if not self.closed:
            try:
                self._blob.close()
            finally:
                super().close()


@dataclass(frozen=True)
class DatabaseMeasurement:
    status: str
    genomes_checked: int
    total_compressed_bytes: int
    uncompressed_bytes: int
    records_scanned: int
    variants_checked: int
    retained_matches: int
    parity_cases: int
    parity_skipped: int
    elapsed_seconds: float
    peak_rss_bytes: int


def validate_database(
    path: Path,
    *,
    parity_limit_bytes: int = PARITY_LIMIT_BYTES,
    require_parity: bool = False,
) -> DatabaseMeasurement:
    """Use one read-only snapshot and one Analyzer for all stored single-sample genomes."""
    if not 1 <= parity_limit_bytes <= PARITY_LIMIT_BYTES:
        raise DatabaseValidationError("The legacy parity limit must be between one byte and 20 MiB.")
    started = time.monotonic()
    genomes_checked = total_compressed_bytes = uncompressed_bytes = records_scanned = variants_checked = 0
    retained_matches = parity_cases = parity_skipped = 0
    uri = f"{path.resolve(strict=True).as_uri()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("BEGIN")  # Keep reference data, metadata and BLOBs in the same read snapshot.
        analyzer = Analyzer(connection)
        loci = analyzer.variants.by_locus
        rows = connection.execute(
            "SELECT rowid AS blob_rowid, sex, length(vcf_gz) AS compressed_bytes FROM genomes ORDER BY id"
        )
        for row in rows:
            rowid, sex, compressed_bytes = row["blob_rowid"], row["sex"], row["compressed_bytes"]
            if (
                type(rowid) is not int
                or sex not in ("male", "female")
                or type(compressed_bytes) is not int
                or compressed_bytes < 1
            ):
                raise DatabaseValidationError("Stored genome metadata is invalid.")
            with SqliteBlobReader(connection.blobopen("genomes", "vcf_gz", rowid, readonly=True)) as raw:
                with io.BufferedReader(raw, buffer_size=BLOB_READ_BYTES) as source:
                    scanned = scan_vcf(source, relevant_loci=loci, compressed=True)
                    report = analyzer.analyze(
                        list(scanned.calls), "", sex, use_llm=False, variants_checked=scanned.variants_checked
                    )
                    eligible = max(compressed_bytes, scanned.uncompressed_bytes) <= parity_limit_bytes
                    if eligible:
                        source.seek(0)
                        compressed = source.read(compressed_bytes)
                        if len(compressed) != compressed_bytes:
                            raise DatabaseValidationError("Stored genome changed during validation.")
                        legacy = analyzer.analyze(read_calls_gz(compressed), "", sex, use_llm=False)
                        if report != legacy:
                            raise DatabaseValidationError("Streaming analysis differs from the legacy report.")
                        parity_cases += 1
                        del compressed, legacy
                    elif require_parity:
                        raise DatabaseValidationError("A stored genome exceeds the bounded legacy parity limit.")
                    else:
                        parity_skipped += 1
            genomes_checked += 1
            total_compressed_bytes += compressed_bytes
            uncompressed_bytes += scanned.uncompressed_bytes
            records_scanned += scanned.records_scanned
            variants_checked += scanned.variants_checked
            retained_matches += len(scanned.calls)
    if not genomes_checked:
        raise DatabaseValidationError("No stored genomes were found.")
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return DatabaseMeasurement(
        status="passed",
        genomes_checked=genomes_checked,
        total_compressed_bytes=total_compressed_bytes,
        uncompressed_bytes=uncompressed_bytes,
        records_scanned=records_scanned,
        variants_checked=variants_checked,
        retained_matches=retained_matches,
        parity_cases=parity_cases,
        parity_skipped=parity_skipped,
        elapsed_seconds=round(time.monotonic() - started, 4),
        peak_rss_bytes=int(peak_rss if sys.platform == "darwin" else peak_rss * 1024),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=db_path())
    parser.add_argument("--parity-limit-bytes", type=int, default=PARITY_LIMIT_BYTES)
    parser.add_argument(
        "--require-parity", action="store_true", help="Fail if any BLOB is too large for bounded legacy parity"
    )
    args = parser.parse_args()
    try:
        measured = validate_database(
            args.database, parity_limit_bytes=args.parity_limit_bytes, require_parity=args.require_parity
        )
    except DatabaseValidationError as error:
        print(f"Database genome validation failed: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        # Third-party parser, SQLite and analysis failures may embed private data.
        print(f"Database genome validation failed ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(json.dumps(asdict(measured), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
