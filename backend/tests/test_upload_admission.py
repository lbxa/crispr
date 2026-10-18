"""Per-source resource admission shares the global reservation transaction."""

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from crispr_backend.api import app
from crispr_backend.uploads.settings import UploadSettings
from crispr_backend.uploads.store import UploadError, UploadRepository


@pytest.fixture
def settings(tmp_path):
    return UploadSettings(
        directory=tmp_path / "uploads",
        max_upload_bytes=4 * 1024**2,
        quota_bytes=20 * 1024**2,
        disk_reserve_bytes=0,
        chunk_size=64 * 1024,
    )


def test_one_source_cannot_take_all_global_slots_and_admission_is_atomic(settings):
    repositories = [UploadRepository(settings) for _ in range(4)]

    def reserve(repository):
        try:
            return repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")[0]["id"]
        except UploadError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(reserve, repositories))
    assert results.count("UPLOAD_SOURCE_CAPACITY") == 2
    # The other two global slots remain available to another source.
    for _ in range(2):
        repositories[0].reserve(100, "vcf", available_bytes=10**12, source_key="source-b")
    with pytest.raises(UploadError) as failure:
        repositories[0].reserve(100, "vcf", available_bytes=10**12, source_key="source-c")
    assert failure.value.code == "UPLOAD_CAPACITY"


def test_creation_budget_counts_canceled_sessions_but_does_not_affect_other_sources(settings):
    repository = UploadRepository(settings)
    for _ in range(settings.creations_per_minute):
        session, _token = repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")
        repository.cancel(session["id"])
        repository.mark_purged(session["id"])
    with pytest.raises(UploadError) as failure:
        repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")
    assert failure.value.code == "UPLOAD_SOURCE_RATE" and failure.value.status_code == 429
    repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-b")
    with repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET created_at=? WHERE source_key='source-a'", (time.time() - 61,))
    assert repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")[0]["status"] == "uploading"


def test_source_bytes_remain_reserved_until_cancel_cleanup_confirms_purge(settings):
    repository = UploadRepository(replace(settings, source_quota_bytes=100))
    session, _token = repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")
    repository.cancel(session["id"])
    with pytest.raises(UploadError) as failure:
        repository.reserve(1, "vcf", available_bytes=10**12, source_key="source-a")
    assert failure.value.code == "UPLOAD_SOURCE_QUOTA"
    repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-b")
    repository.mark_purged(session["id"])
    assert repository.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")[0]["status"] == "uploading"


def test_legacy_job_database_migrates_without_resetting_tokens_or_state(settings):
    repository = UploadRepository(settings)
    session, token = repository.reserve(100, "vcf", available_bytes=10**12)
    # Reproduce the schema from before source admission was introduced.
    with repository.connection(write=True) as connection:
        connection.execute("DROP INDEX uploads_source_created")
        connection.execute("ALTER TABLE uploads DROP COLUMN source_key")
    migrated = UploadRepository(settings)
    preserved = migrated.authenticate(token, session["id"])
    assert preserved["status"] == "uploading" and preserved["source_key"] is None
    assert migrated.reserve(100, "vcf", available_bytes=10**12, source_key="source-a")[0]["source_key"] == "source-a"


def test_adapter_uses_asgi_client_and_ignores_forged_forwarded_headers(database, tmp_path, monkeypatch):
    monkeypatch.setenv("CRISPR_UPLOAD_DIR", str(tmp_path / "http-uploads"))
    monkeypatch.setenv("CRISPR_UPLOAD_DISK_RESERVE_BYTES", "0")
    source_a = "198.51.100.10"
    source_b = "198.51.100.11"
    with TestClient(app, client=(source_a, 40000)) as client:
        for spoofed in ("203.0.113.1", "203.0.113.2"):
            assert (
                client.post(
                    "/uploads",
                    json={"size_bytes": 100, "format": "vcf"},
                    headers={
                        "X-Forwarded-For": spoofed,
                        "X-Real-IP": spoofed,
                        "Forwarded": f"for={spoofed}",
                    },
                ).status_code
                == 201
            )
        response = client.post(
            "/uploads",
            json={"size_bytes": 100, "format": "vcf"},
            headers={
                "X-Forwarded-For": "203.0.113.3",
                "Forwarded": "for=203.0.113.3",
            },
        )
        assert response.status_code == 429 and response.json()["error"]["code"] == "UPLOAD_SOURCE_CAPACITY"
    with TestClient(app, client=(source_b, 40001)) as other:
        assert other.post("/uploads", json={"size_bytes": 100, "format": "vcf"}).status_code == 201
        with app.state.uploads.repository.connection() as connection:
            keys = [row["source_key"] for row in connection.execute("SELECT source_key FROM uploads")]
    assert keys.count(hashlib.sha256(source_a.encode()).hexdigest()) == 2
    assert keys.count(hashlib.sha256(source_b.encode()).hexdigest()) == 1
    assert source_a not in json.dumps(keys) and source_b not in json.dumps(keys)


@pytest.mark.parametrize(
    "change",
    [
        {"max_active_uploads_per_source": 0},
        {"creations_per_minute": 0},
        {"source_quota_bytes": 0},
    ],
)
def test_source_admission_limits_must_be_positive(settings, change):
    with pytest.raises(ValueError, match="positive"):
        replace(settings, **change)
