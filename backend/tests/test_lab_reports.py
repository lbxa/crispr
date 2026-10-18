"""Lab exports use the saved genome, never catalog targets or a second analysis."""

import io
import json

import pytest
from conftest import vcf
from fastapi.testclient import TestClient
from pypdf import PdfReader
from test_uploads import headers, reserved

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.api import app
from crispr_backend.reporting import gene_plans
from crispr_backend.security import ConcurrencyCap, RateLimiter
from crispr_backend.uploads import routes
from crispr_backend.uploads.worker import AnalysisWorker


@pytest.fixture
def client(database, tmp_path, monkeypatch):
    monkeypatch.setenv("CRISPR_UPLOAD_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("CRISPR_UPLOAD_DISK_RESERVE_BYTES", "0")
    routes.REPORTS_PER_MINUTE.reset()
    with TestClient(app) as client:
        yield client


def complete_genome(database, records=None):
    service = app.state.uploads
    created = reserved(service, vcf("LAB_TEST", records or [(1100, "1|0"), (1200, "0|1")]).encode())
    with db.session(database) as connection:
        analyzer = Analyzer(connection)
    assert AnalysisWorker(service, analyzer).run_once()
    return created


def test_completed_view_exposes_actual_gene_plans_without_carrier_targets(client, database):
    created = complete_genome(database)
    view = client.get(f"/uploads/{created['id']}", headers=headers(created)).json()
    report = view["report"]
    assert [plan["gene"] for plan in report["gene_plans"]] == ["MEFV"]
    assert {edit["variation_id"] for edit in report["gene_plans"][0]["edits"]} == {1, 3}
    assert report["findings"][0]["variants"][0]["pos"] == 1100
    assert "symptoms" not in report
    carrier = complete_genome(database, [(1150, "0|1")])
    carrier_report = client.get(f"/uploads/{carrier['id']}", headers=headers(carrier)).json()["report"]
    assert carrier_report["gene_plans"] == []


def test_pdf_contains_saved_findings_and_full_lab_evidence(client, database):
    created = complete_genome(database)
    before = app.state.uploads.repository.get(created["id"])
    response = client.get(f"/uploads/{created['id']}/report.pdf", headers=headers(created))
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-disposition"] == f'attachment; filename="genome-lab-report-{created["id"]}.pdf"'
    assert response.content.startswith(b"%PDF-")
    pdf = PdfReader(io.BytesIO(response.content))
    text = "\n".join(page.extract_text() for page in pdf.pages)
    assert pdf.metadata is not None
    assert pdf.metadata.title == "Genome Laboratory Report"
    assert "Laboratory report" in text and "Genome" in text
    assert created["id"] in text
    assert before["sha256"] in text
    assert "MEFV variant 1" in text and "MEFV variant 3" in text
    assert "1100" in text and "1200" in text
    assert "Off-target assessment" in text
    assert "Not assessed" in text
    assert "Repair template" in text
    assert "Clinical eligibility has not been established" in text
    assert "genome_truth" not in text
    assert app.state.uploads.repository.get(created["id"])["report_json"] == before["report_json"]


def test_pdf_requires_the_exact_capability_and_a_completed_job(client, database):
    created = complete_genome(database)
    other = client.post("/uploads", json={"size_bytes": 50, "format": "vcf"}).json()
    url = f"/uploads/{created['id']}/report.pdf"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=headers(other)).status_code == 401
    assert client.get(f"/uploads/{other['id']}/report.pdf", headers=headers(other)).status_code == 409


def test_pdf_fails_safely_for_an_unsupported_saved_report(client, database, monkeypatch):
    created = complete_genome(database)
    original = app.state.uploads.repository.authenticate

    def unsupported(token, upload_id=None):
        session = original(token, upload_id)
        return {**session, "report_json": json.dumps({"private": "do not leak this"})}

    monkeypatch.setattr(app.state.uploads.repository, "authenticate", unsupported)
    response = client.get(f"/uploads/{created['id']}/report.pdf", headers=headers(created))
    assert response.status_code == 503
    assert "do not leak" not in response.text


def test_saved_gene_plans_preserve_the_analysis_threshold(client, database, monkeypatch):
    created = complete_genome(database)
    report = json.loads(app.state.uploads.repository.get(created["id"])["report_json"])
    edit = report["findings"][0]["crispr"][0]
    edit["advisability"].update(score=55, threshold=60, band="moderate", recommended=False)
    monkeypatch.setenv("CRISPR_ADVISE_THRESHOLD", "10")
    plan = gene_plans(report)[0]
    assert plan["overview"]["threshold"] == 60
    assert plan["overview"]["score"] == 55
    assert plan["overview"]["verdict"] == "not_recommended"


def test_pdf_is_bounded_by_existing_rate_and_concurrency_policies(client, database, monkeypatch):
    created = complete_genome(database)
    url = f"/uploads/{created['id']}/report.pdf"
    cap = ConcurrencyCap(1)
    monkeypatch.setattr(routes, "ACTIVE_REPORTS", cap)
    with cap:
        response = client.get(url, headers=headers(created))
    assert response.status_code == 429 and "retry-after" in response.headers
    limiter = RateLimiter(1)
    monkeypatch.setattr(routes, "REPORTS_PER_MINUTE", limiter)
    assert client.get(url, headers=headers(created)).status_code == 200
    response = client.get(url, headers=headers(created))
    assert response.status_code == 429 and "retry-after" in response.headers


def test_pdf_expired_capability_is_refused(client, database):
    created = complete_genome(database)
    with app.state.uploads.repository.connection(write=True) as connection:
        connection.execute("UPDATE uploads SET expires_at=0 WHERE id=?", (created["id"],))
    response = client.get(f"/uploads/{created['id']}/report.pdf", headers=headers(created))
    assert response.status_code == 410


def test_render_failure_has_safe_errors_and_releases_capacity(client, database, monkeypatch, caplog):
    created = complete_genome(database)
    original = routes.render_lab_pdf

    def broken(_report):
        raise ValueError("private sequence must never be logged")

    monkeypatch.setattr(routes, "render_lab_pdf", broken)
    url = f"/uploads/{created['id']}/report.pdf"
    response = client.get(url, headers=headers(created))
    assert response.status_code == 503
    assert "private sequence" not in response.text and "private sequence" not in caplog.text
    assert "lab_report.failed" in caplog.text
    monkeypatch.setattr(routes, "render_lab_pdf", original)
    assert client.get(url, headers=headers(created)).status_code == 200
