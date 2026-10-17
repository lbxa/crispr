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
