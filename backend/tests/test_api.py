import re
from pathlib import Path

from conftest import vcf
from fastapi.testclient import TestClient

from crispr_backend.api import app

ANALYSIS_DIR = Path(__file__).resolve().parent.parent / "crispr_backend" / "analysis"


def test_health_and_panel(database):
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert len(client.get("/diseases").json()) == 24


def test_analyze_finds_the_disease_matching_genome_and_symptoms(database):
    genome = vcf("S1", [(1100, "1|0"), (1200, "0|1")])
    with TestClient(app) as client:
        report = client.post(
            "/analyze", json={"vcf": genome, "symptoms": "I get recurrent fevers and abdominal pain", "sex": "female"}
        ).json()
    assert report["conclusion"]["status"] == "likely_genetic_cause"
    finding = report["findings"][0]
    assert finding["disease"] == "Familial Mediterranean fever" and finding["tier"] == "likely"
    assert finding["crispr"] and finding["crispr"][0]["off_target"].startswith("Not assessed")


def test_carrier_is_not_a_diagnosis(database):
    with TestClient(app) as client:
        report = client.post("/analyze", json={"vcf": vcf("S1", [(1150, "0|1")]), "symptoms": "fatigue"}).json()
    assert report["conclusion"]["status"] == "carrier_only"
    assert report["findings"][0]["crispr"] == []


def test_order_flow(database):
    with TestClient(app) as client:
        created = client.post("/orders")
        assert created.status_code == 202
        order_id = created.json()["id"]
        order = client.get(f"/orders/{order_id}").json()  # background task has run by now
        assert order["status"] == "ready", order["error"]
        assert order["symptoms"] and order["report"]["disclaimer"]
        assert client.get(f"/orders/{order_id}/genome.vcf").text.startswith("##fileformat")
        assert "planted_disease" in client.get(f"/orders/{order_id}/truth").json()
        assert client.get("/orders/missing").status_code == 404


def test_bad_vcf_is_rejected(database):
    with TestClient(app) as client:
        assert client.post("/analyze", json={"vcf": "chr1\t1\t.\tA\tG\t.\tPASS\t."}).status_code == 422


def test_analysis_never_reads_simulation_ground_truth():
    for source in ANALYSIS_DIR.glob("*.py"):
        text = source.read_text()
        assert not re.search(r"(FROM|JOIN)\s+genome_(truth|symptoms)", text, re.IGNORECASE), source.name
        assert "crispr_backend.simulation" not in text, source.name


def test_genome_endpoints_hide_ground_truth(database):
    with TestClient(app) as client:
        genomes = client.get("/genomes").json()
        assert genomes == [
            {"id": 1, "sample_id": "HG00001", "sex": "female"},
            {"id": 2, "sample_id": "HG00002", "sex": "male"},
        ]
        assert client.get("/genomes/1/genome.vcf").text.startswith("##fileformat")
        assert client.get("/genomes/99/genome.vcf").status_code == 404


def test_analyze_a_chosen_genome_without_the_language_model(database):
    with TestClient(app) as client:
        report = client.post(
            "/genomes/1/analyze", json={"symptoms": "recurrent fevers and abdominal pain", "use_llm": False}
        ).json()
    assert report["symptoms"]["extraction"] == "keyword"
    assert report["findings"][0]["disease"] == "Familial Mediterranean fever"


def test_orders_are_capped_while_others_are_processing(database, monkeypatch):
    import crispr_backend.api as api

    monkeypatch.setattr(api, "MAX_ACTIVE_ORDERS", 0)
    with TestClient(app) as client:
        assert client.post("/orders").status_code == 429


def test_cors_allows_the_website_and_local_development(database):
    with TestClient(app) as client:
        for origin in ("https://genome.lbxa.net", "https://crispr.team-account.workers.dev", "http://localhost:3000"):
            response = client.get("/health", headers={"Origin": origin})
            assert response.headers.get("access-control-allow-origin") == origin
        assert (
            "access-control-allow-origin"
            not in client.get("/health", headers={"Origin": "https://evil.example"}).headers
        )
