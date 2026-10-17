import gzip
import hashlib
import sqlite3
import sys
from collections.abc import Buffer

import pytest

from scripts import validate_database_genomes as validation


def test_existing_blob_reports_match_without_writes_or_private_metadata(database, monkeypatch):
    before = hashlib.sha256(database.read_bytes()).digest()
    connect = sqlite3.connect
    reads: list[tuple[str | None, str | None]] = []

    def read_only_connection(database_uri, **kwargs):
        assert database_uri.endswith("?mode=ro")
        assert kwargs == {"uri": True}
        connection = connect(database_uri, **kwargs)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("CREATE TABLE forbidden_write (value INTEGER)")

        def authorize(action, table, column, _database, _trigger):
            if action == sqlite3.SQLITE_READ:
                reads.append((table, column))
                if table in ("genome_truth", "genome_symptoms", "orders") or column == "sample_id":
                    return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        connection.set_authorizer(authorize)
        return connection

    monkeypatch.setattr(validation.sqlite3, "connect", read_only_connection)

    result = validation.validate_database(database, require_parity=True)

    assert result.status == "passed"
    assert result.genomes_checked == result.parity_cases == 2
    assert result.parity_skipped == 0
    assert result.records_scanned == result.variants_checked == result.retained_matches == 3
    assert result.total_compressed_bytes > 0
    assert result.uncompressed_bytes > 0
    assert reads
    assert hashlib.sha256(database.read_bytes()).digest() == before
    assert not list(database.parent.glob("*.vcf*"))


def test_large_blobs_never_call_legacy_reader_and_use_bounded_reads(database, monkeypatch):
    requested: list[int] = []
    reader = validation.SqliteBlobReader

    class MeasuredReader(reader):
        def readinto(self, buffer: Buffer) -> int:
            requested.append(memoryview(buffer).nbytes)
            return super().readinto(buffer)

    def forbidden_legacy(_blob):
        raise AssertionError("Large BLOBs must not be buffered for legacy parsing")

    monkeypatch.setattr(validation, "SqliteBlobReader", MeasuredReader)
    monkeypatch.setattr(validation, "read_calls_gz", forbidden_legacy)

    result = validation.validate_database(database, parity_limit_bytes=1)

    assert result.parity_cases == 0
    assert result.parity_skipped == result.genomes_checked == 2
    assert result.variants_checked == 3
    assert requested and max(requested) <= 64 * 1024


def test_expanded_size_also_limits_legacy_parity(database):
    text = (
        "##fileformat=VCFv4.2\n"
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPRIVATE_SAMPLE\n"
        f"chr2\t1000000\t.\tA\tG\t.\tPASS\tPAD={'A' * 8192}\tGT\t0/1\n"
    ).encode()
    compressed = gzip.compress(text)
    assert len(compressed) < 1024 < len(text)
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO genomes VALUES (3, 'PRIVATE_SAMPLE', 'male', ?)", (compressed,))

    result = validation.validate_database(database, parity_limit_bytes=1024)

    assert result.genomes_checked == 3
    assert result.parity_cases == 2
    assert result.parity_skipped == 1
    assert result.variants_checked == 4
    assert result.retained_matches == 3


def test_require_parity_and_report_mismatch_fail_without_reporting_genomes(database, monkeypatch):
    with pytest.raises(validation.DatabaseValidationError, match="between one byte and 20 MiB"):
        validation.validate_database(database, parity_limit_bytes=validation.PARITY_LIMIT_BYTES + 1)
    with pytest.raises(validation.DatabaseValidationError, match="exceeds the bounded legacy parity limit"):
        validation.validate_database(database, parity_limit_bytes=1, require_parity=True)

    monkeypatch.setattr(validation, "read_calls_gz", lambda _blob: [])
    with pytest.raises(validation.DatabaseValidationError, match="differs from the legacy report"):
        validation.validate_database(database, require_parity=True)


def test_cli_redacts_unexpected_errors(database, monkeypatch, capsys):
    def fail(*_args, **_kwargs):
        raise ValueError("PRIVATE_SAMPLE PRIVATE_VARIANT PRIVATE_REPORT")

    monkeypatch.setattr(validation, "validate_database", fail)
    monkeypatch.setattr(sys, "argv", ["validate_database_genomes", "--database", str(database)])

    assert validation.main() == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert "ValueError" in output.err
    assert "PRIVATE" not in output.err
