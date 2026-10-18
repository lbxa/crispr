"""Upload policy, durable state transitions and the tusd filesystem contract."""

import gzip
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from conftest import vcf
from fastapi.testclient import TestClient

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.api import app
from crispr_backend.uploads.service import UploadService
from crispr_backend.uploads.settings import UploadSettings
from crispr_backend.uploads.store import UploadError, UploadFormat, UploadRepository
from crispr_backend.uploads.worker import AnalysisWorker


@pytest.fixture
def service(tmp_path):
    return UploadService(
        UploadSettings(
            directory=tmp_path / "uploads",
            max_upload_bytes=4 * 1024**2,
            quota_bytes=20 * 1024**2,
            disk_reserve_bytes=0,
            chunk_size=64 * 1024,
        )
    )


@pytest.fixture
def client(database, tmp_path, monkeypatch):
    monkeypatch.setenv("CRISPR_UPLOAD_DIR", str(tmp_path / "api-uploads"))
    monkeypatch.setenv("CRISPR_UPLOAD_DISK_RESERVE_BYTES", "0")
    with TestClient(app) as test_client:
        yield test_client


def headers(created: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {created['token']}"}


def hook(created: dict, *, size: int, format: str = "vcf", type: str = "pre-create") -> dict:
    return {
        "Type": type,
        "Event": {
            "Upload": {
                "ID": created["id"] if type == "post-finish" else "",
                "Size": size,
                "Offset": size,
                "MetaData": {"session_id": created["id"], "format": format},
            },
            "HTTPRequest": {"Header": {"Authorization": [f"Bearer {created['token']}"]}},
        },
    }


def write_receipt(
    service: UploadService, created: dict, data: bytes, *, size: int | None = None, format: str = "vcf"
) -> None:
    path = service.tus.path(created["id"])
    path.write_bytes(data)
    # A real tusd filestore leaves Offset at zero even after successful PATCH.
    path.with_suffix(".info").write_text(
        json.dumps(
            {
                "ID": created["id"],
                "Size": len(data) if size is None else size,
                "Offset": 0,
                "SizeIsDeferred": False,
                "MetaData": {"session_id": created["id"], "format": format},
            }
        )
    )


def reserved(service: UploadService, data: bytes, *, format: UploadFormat = "vcf") -> dict:
    created = service.create(len(data), format)
    service.repository.mark_tus_created(created["id"])
    write_receipt(service, created, data, format=format)
    service.complete(service.authenticate(created["token"], created["id"]))
    return created


def test_create_session_has_no_filename_or_plaintext_token_in_storage(client):
    response = client.post("/uploads", json={"size_bytes": 30 * 1024**2, "format": "vcf_gzip"})
    assert response.status_code == 201
    result = response.json()
    assert result["status"] == "uploading" and result["chunk_size"] == 8 * 1024**2
    assert result["max_upload_bytes"] == 10 * 1024**3
    assert response.headers["cache-control"] == "private, no-store"
    session = app.state.uploads.repository.get(result["id"])
    assert session["token_hash"] == hashlib.sha256(result["token"].encode()).hexdigest()
    assert result["token"] not in json.dumps(session)
    assert "filename" not in session
    assert (
        client.post("/uploads", json={"filename": "patient.vcf", "size_bytes": 20, "format": "vcf"}).status_code == 422
    )
    assert client.post("/uploads", json={"size_bytes": 10 * 1024**3 + 1, "format": "vcf"}).status_code == 413
    assert client.post("/uploads", json={"size_bytes": True, "format": "vcf"}).status_code == 422


def test_capability_is_bound_to_exact_session_and_transfer_method(client):
    one = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    two = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    assert client.get(f"/uploads/{one['id']}").status_code == 401
    assert client.get(f"/uploads/{one['id']}", headers=headers(two)).status_code == 401
    assert client.get(f"/uploads/{one['id']}", headers=headers(one)).json()["uploaded_bytes"] == 0
    for method, uri, expected in (
        ("POST", "/files/", 204),
        ("PATCH", f"/files/{one['id']}", 204),
        ("HEAD", f"/files/{one['id']}", 204),
        ("GET", f"/files/{one['id']}", 403),
        ("DELETE", f"/files/{one['id']}", 403),
        ("PATCH", f"/files/{two['id']}", 403),
        ("PATCH", f"/files/{one['id']}/extra", 403),
        ("PATCH", f"/files/%2e%2e/{one['id']}", 403),
    ):
        response = client.get(
            "/internal/uploads/authorize",
            headers={
                **headers(one),
                "X-Forwarded-Method": method,
                "X-Forwarded-Uri": uri,
            },
        )
        assert response.status_code == expected, (method, uri, response.text)
    assert (
        client.get(
            "/internal/uploads/authorize",
            headers={
                "Origin": "https://evil.example",
                "X-Forwarded-Method": "OPTIONS",
            },
        ).status_code
        == 403
    )
    for origin in ("https://genome.lbxa.net", "http://localhost:3000"):
        assert (
            client.get(
                "/internal/uploads/authorize",
                headers={
                    "Origin": origin,
                    "X-Forwarded-Method": "OPTIONS",
                },
            ).status_code
            == 204
        )


def test_tus_hook_claims_once_and_never_persists_untrusted_metadata(client):
    created = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    payload = hook(created, size=50)
    payload["Event"]["Upload"]["MetaData"]["filename"] = "private-patient-name.vcf"
    response = client.post("/internal/uploads/tus-hook", json=payload)
    assert response.status_code == 200
    assert response.json() == {
        "ChangeFileInfo": {
            "ID": created["id"],
            "MetaData": {
                "session_id": created["id"],
                "format": "vcf",
            },
        }
    }
    duplicate = client.post("/internal/uploads/tus-hook", json=payload).json()
    assert duplicate["RejectUpload"] and duplicate["HTTPResponse"]["StatusCode"] == 409


@pytest.mark.parametrize("mutation", ["size", "format", "deferred", "missing_session", "token", "origin"])
def test_tus_hook_rejects_unbound_declarations(client, mutation):
    created = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    payload = hook(created, size=50)
    upload = payload["Event"]["Upload"]
    if mutation == "size":
        upload["Size"] = 51
    elif mutation == "format":
        upload["MetaData"]["format"] = "vcf_gzip"
    elif mutation == "deferred":
        upload["SizeIsDeferred"] = True
    elif mutation == "missing_session":
        del upload["MetaData"]["session_id"]
    elif mutation == "token":
        payload["Event"]["HTTPRequest"]["Header"]["Authorization"] = ["Bearer invalid"]
    else:
        payload["Event"]["HTTPRequest"]["Header"]["Origin"] = ["https://evil.example"]
    response = client.post("/internal/uploads/tus-hook", json=payload)
    assert response.status_code == 200 and response.json()["RejectUpload"]
    assert not app.state.uploads.repository.get(created["id"])["tus_created"]


def test_completion_checks_stored_size_and_ignores_stale_info_offset(client):
    content = vcf("S1", [(1100, "0|1")]).encode()
    created = client.post("/uploads", json={"size_bytes": len(content), "format": "vcf"}).json()
    assert client.post("/internal/uploads/tus-hook", json=hook(created, size=len(content))).status_code == 200
    write_receipt(app.state.uploads, created, content[:-1], size=len(content))
    response = client.post(f"/uploads/{created['id']}/complete", headers=headers(created))
    assert response.status_code == 409 and response.json()["error"]["code"] == "UPLOAD_INCOMPLETE"
    assert (
        client.get(f"/uploads/{created['id']}", headers=headers(created)).json()["uploaded_bytes"] == len(content) - 1
    )
    write_receipt(app.state.uploads, created, content)
    for _ in range(2):
        response = client.post(f"/uploads/{created['id']}/complete", headers=headers(created))
        assert response.status_code == 202 and response.json()["status"] == "queued"
    assert app.state.uploads.repository.get(created["id"])["attempts"] == 0
    # Completed bytes are immutable through the public transfer path.
    assert (
        client.get(
            "/internal/uploads/authorize",
            headers={
                **headers(created),
                "X-Forwarded-Method": "PATCH",
                "X-Forwarded-Uri": f"/files/{created['id']}",
            },
        ).status_code
        == 403
    )


def test_missed_finish_hook_is_reconciled_and_cancel_does_not_resurrect_upload(service):
    content = vcf("S1", [(1100, "0|1")]).encode()
    created = service.create(len(content), "vcf")
    service.repository.mark_tus_created(created["id"])
    write_receipt(service, created, content)
    service.reconcile()
    assert service.repository.get(created["id"])["status"] == "queued"
    service.cancel(service.authenticate(created["token"]))
    with pytest.raises(UploadError, match="no longer active"):
        service.complete(service.authenticate(created["token"]))


def test_reservation_capacity_is_atomic_across_connections(service):
    settings = replace(service.settings, max_active_uploads=1)
    repositories = [UploadRepository(settings), UploadRepository(settings)]

    def reserve_one(repository):
        try:
            return repository.reserve(100, "vcf", available_bytes=100_000)[0]["id"]
        except UploadError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve_one, repositories))
    assert results.count("UPLOAD_CAPACITY") == 1


def test_quota_and_pending_reservations_protect_free_disk(service):
    repository = service.repository
    with pytest.raises(UploadError) as error:
        repository.reserve(100, "vcf", available_bytes=99)
    assert error.value.code == "UPLOAD_DISK_FULL"
    repository.reserve(100, "vcf", available_bytes=1000)
    with pytest.raises(UploadError) as error:
        repository.reserve(100, "vcf", available_bytes=150)
    assert error.value.code == "UPLOAD_DISK_FULL"
    smaller = UploadRepository(replace(service.settings, quota_bytes=service.settings.max_upload_bytes))
    with pytest.raises(UploadError) as error:
        smaller.reserve(service.settings.max_upload_bytes, "vcf", available_bytes=10**12)
    assert error.value.code == "UPLOAD_QUOTA"


def test_empty_reservations_expire_quickly_but_stored_progress_extends_retention(service):
    created = service.create(50, "vcf")
    empty = service.authenticate(created["token"])
    assert 290 < empty["expires_at"] - time.time() <= 300
    service.repository.mark_tus_created(created["id"])
    service.tus.path(created["id"]).write_bytes(b"partial")
    service.view(empty)
    active = service.authenticate(created["token"])
    assert active["uploaded_bytes"] == 7
    assert active["expires_at"] - time.time() > 23 * 60 * 60


def test_progress_is_observed_before_expiring_a_slow_first_patch(service):
    created = service.create(50, "vcf")
    service.repository.mark_tus_created(created["id"])
    write_receipt(service, created, b"partial", size=50)
    with service.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET expires_at=? WHERE id=?", (time.time() - 1, created["id"]))
    service.reconcile()
    session = service.authenticate(created["token"])
    assert session["status"] == "uploading" and session["uploaded_bytes"] == 7
    assert session["expires_at"] - time.time() > 23 * 60 * 60


def test_next_patch_auth_recovers_first_byte_progress_when_worker_is_busy(service):
    created = service.create(50, "vcf")
    service.repository.mark_tus_created(created["id"])
    write_receipt(service, created, b"partial", size=50)
    with service.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET expires_at=? WHERE id=?", (time.time() - 1, created["id"]))
    session = service.authenticate(created["token"])
    assert session["status"] == "uploading" and session["uploaded_bytes"] == 7


def test_symlinks_and_forged_receipts_cannot_escape_storage(service, tmp_path):
    data = b"unrelated private bytes"
    created = service.create(len(data), "vcf")
    write_receipt(service, created, data)
    outside = tmp_path / "outside.vcf"
    outside.write_bytes(data)
    service.tus.path(created["id"]).unlink()
    service.tus.path(created["id"]).symlink_to(outside)
    with pytest.raises(UploadError):
        service.tus.verify_complete(service.authenticate(created["token"]))
    with pytest.raises(UploadError):
        service.tus.path("../outside.vcf")
    assert outside.read_bytes() == data


def test_expiry_and_cancel_cleanup_wait_for_active_lease(service, monkeypatch):
    created = reserved(service, b"tiny")
    claimed = service.repository.claim_next_job()
    assert claimed is not None
    service.cancel(service.authenticate(created["token"]))
    terminated = []
    monkeypatch.setattr(service.tus, "terminate", lambda upload_id: terminated.append(upload_id) or True)
    service.reconcile()
    assert terminated == []
    service.repository.release_interrupted(created["id"], claimed["lease_id"])
    service.reconcile()
    assert terminated == []  # A delayed pre-create POST may still write its receipt.
    with service.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET updated_at=? WHERE id=?", (time.time() - 61, created["id"]))
    service.reconcile()
    assert terminated == [created["id"]]
    assert service.repository.get(created["id"])["purged"] == 1
    expired = service.create(10, "vcf")
    with service.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET expires_at=? WHERE id=?", (time.time() - 1, expired["id"]))
    service.reconcile()
    assert service.repository.get(expired["id"])["status"] == "expired"


def test_cleanup_resweeps_purged_tombstones_for_late_creation_receipts(service, monkeypatch):
    created = service.create(50, "vcf")
    service.repository.mark_tus_created(created["id"])
    service.cancel(service.authenticate(created["token"]))
    terminated = []
    monkeypatch.setattr(service.tus, "terminate", lambda upload_id: terminated.append(upload_id) or True)
    for _ in range(2):
        with service.repository.connection(write=True) as connection:
            connection.execute("UPDATE uploads SET updated_at=? WHERE id=?", (time.time() - 61, created["id"]))
        service.reconcile()
    assert terminated == [created["id"], created["id"]]


def test_tus_hook_rejects_upload_data_during_creation(client):
    created = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    payload = hook(created, size=50)
    payload["Event"]["HTTPRequest"]["Header"]["Content-Type"] = ["application/offset+octet-stream"]
    response = client.post("/internal/uploads/tus-hook", json=payload).json()
    assert response["RejectUpload"] and response["HTTPResponse"]["StatusCode"] == 400
    assert not app.state.uploads.repository.get(created["id"])["tus_created"]


def test_lease_recovery_fences_old_worker_and_prevents_parallel_claim(service):
    created = reserved(service, b"tiny")
    old = service.repository.claim_next_job()
    assert old and UploadRepository(service.settings).claim_next_job() is None
    with service.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET lease_until=? WHERE id=?", (time.time() - 1, created["id"]))
    recovered = service.repository.claim_next_job()
    assert recovered and recovered["lease_id"] != old["lease_id"] and recovered["attempts"] == 2
    assert not service.repository.finish(created["id"], old["lease_id"], report={"stale": True})
    service.repository.release_interrupted(created["id"], recovered["lease_id"])
    last = service.repository.claim_next_job()
    assert last and last["attempts"] == 3
    service.repository.release_interrupted(created["id"], last["lease_id"])
    assert service.repository.claim_next_job() is None
    assert service.repository.get(created["id"])["status"] == "failed"


@pytest.mark.parametrize("compressed", [False, True])
@pytest.mark.parametrize("sample_id", ["S1", "HG001"])
def test_worker_streams_file_and_reports_total_variants_without_retaining_irrelevant_calls(
    service, database, compressed, sample_id
):
    data = vcf(sample_id, [(1100, "1|0"), (1200, "0|1"), (1250, "0|1")]).encode()
    if sample_id == "S1":
        data = data.replace(b"#CHROM", b"##SAMPLE=<ID=S1,Sex=female>\n#CHROM")
    content = gzip.compress(data) if compressed else data
    created = reserved(service, content, format="vcf_gzip" if compressed else "vcf")
    with db.session() as connection:
        worker = AnalysisWorker(service, Analyzer(connection))
    assert worker.run_once()
    result = service.view(service.authenticate(created["token"]))
    assert result["status"] == "complete" and result["records_scanned"] == 3
    assert result["variants_checked"] == 3 and result["retained_variants"] == 2
    assert result["report"]["genome"]["variants_checked"] == 3
    assert result["report"]["genome"]["model_profile"] == "female"
    assert "symptoms" not in result["report"]
    assert "source" not in result["report"]["summary"]
    for finding in result["report"]["findings"]:
        assert set(finding) == {"tier", "gene", "disease"}
    assert result["sha256"] == hashlib.sha256(content).hexdigest()
    assert result["uncompressed_bytes"] == len(data)
    assert not worker.run_once()
    # A late cancel or duplicate completion cannot destroy a completed report.
    assert service.cancel(service.authenticate(created["token"]))["status"] == "complete"
    assert service.complete(service.authenticate(created["token"]))["report"] == result["report"]


def test_worker_persists_body_mapping_without_enabling_symptom_extraction(service, database, monkeypatch):
    from test_llm import gemini_reply, gemini_with

    client, session = gemini_with(
        gemini_reply({"text": '{"mappings":[{"finding_index":0,"region_ids":["digestive_tract"]}]}'})
    )
    monkeypatch.setattr("crispr_backend.analysis.body_map.get_llm", lambda **_: client)
    created = reserved(service, vcf("S1", [(1100, "1|0"), (1200, "0|1")]).encode())
    with db.session(database) as connection:
        worker = AnalysisWorker(service, Analyzer(connection))
    assert worker.run_once()
    report = service.view(service.authenticate(created["token"]))["report"]
    assert report["body_map"]["status"] == "mapped"
    assert report["body_map"]["mappings"] == [{"finding_index": 0, "region_ids": ["digestive_tract"]}]
    assert len(session.calls) == 1
    assert service.complete(service.authenticate(created["token"]))["report"] == report
    assert not worker.run_once() and len(session.calls) == 1


def test_invalid_vcf_is_terminal_and_never_publishes_partial_report(service, database):
    created = reserved(service, b"not a vcf")
    with db.session() as connection:
        AnalysisWorker(service, Analyzer(connection)).run_once()
    result = service.view(service.authenticate(created["token"]))
    assert result["status"] == "failed" and result["report"] is None
    assert result["error"]["code"] == "INVALID_VCF" and not result["error"]["retryable"]
    with pytest.raises(UploadError):
        service.retry(service.authenticate(created["token"]))


def test_transient_worker_failure_requires_explicit_idempotent_retry(service, database, monkeypatch):
    created = reserved(service, vcf("S1", [(1100, "0|1")]).encode())
    with db.session() as connection:
        worker = AnalysisWorker(service, Analyzer(connection))
    original = service.tus.open_complete

    def unavailable(_session):
        raise OSError("Sensitive filename must not be returned")

    monkeypatch.setattr(service.tus, "open_complete", unavailable)
    assert worker.run_once()
    failed = service.view(service.authenticate(created["token"]))
    assert failed["error"]["code"] == "ANALYSIS_STORAGE" and failed["error"]["retryable"]
    assert "Sensitive" not in json.dumps(failed)
    assert not worker.run_once()
    monkeypatch.setattr(service.tus, "open_complete", original)
    for _ in range(2):
        assert service.retry(service.authenticate(created["token"]))["status"] == "queued"
    assert worker.run_once() and service.view(service.authenticate(created["token"]))["status"] == "complete"


def test_cancel_during_scan_prevents_report_publication(service, database, monkeypatch):
    import crispr_backend.uploads.worker as module

    created = reserved(service, vcf("S1", [(1100, "0|1")]).encode())
    original = module.scan_vcf

    def cancel_then_scan(*args, **kwargs):
        service.cancel(service.authenticate(created["token"]))
        return original(*args, **kwargs)

    monkeypatch.setattr(module, "scan_vcf", cancel_then_scan)
    with db.session() as connection:
        AnalysisWorker(service, Analyzer(connection)).run_once()
    result = service.view(service.authenticate(created["token"]))
    assert result["status"] == "canceled" and result["report"] is None
    assert service.repository.get(created["id"])["lease_id"] is None
