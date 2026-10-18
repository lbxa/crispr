import json
from copy import deepcopy

import pytest
import requests
from conftest import vcf
from test_llm import gemini_reply, gemini_with

from crispr_backend import db
from crispr_backend.analysis import body_map
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.uploads.service import public_report
from crispr_backend.vcf import read_calls


def finding(tier="possible"):
    return {
        "tier": tier,
        "omim_id": "OMIM:249100",
        "gene": "MEFV",
        "disease": "Familial Mediterranean fever",
        "variants": [{"private": "RAW_VARIANT"}],
        "phenotype": {"private": "PATIENT_SYMPTOMS"},
    }


def configure(monkeypatch, reply, status=200):
    client, session = gemini_with(gemini_reply({"text": json.dumps(reply)}), status)
    monkeypatch.setattr(body_map, "get_llm", lambda **_: client)
    return session


def test_maps_all_eligible_findings_without_sending_genome_or_patient_text(monkeypatch):
    mappings = [
        {"finding_index": 0, "region_ids": ["digestive_tract", "major_joints"]},
        {"finding_index": 2, "region_ids": ["major_joints"]},
    ]
    session = configure(monkeypatch, {"mappings": mappings})
    findings = [finding("likely"), finding("carrier"), finding()]
    original = deepcopy(findings)
    result = body_map.build_body_map(findings, enabled=True)
    assert result == {"version": 1, "status": "mapped", "source": "gemini", "mappings": mappings}
    assert findings == original and len(session.calls) == 1
    _, request = session.calls[0]
    payload = json.loads(request["contents"][0]["parts"][0]["text"])
    assert [item["finding_index"] for item in payload["findings"]] == [0, 2]
    assert payload["available_regions"] == dict(body_map.ANATOMY_REGIONS)
    assert "RAW_VARIANT" not in str(request) and "PATIENT_SYMPTOMS" not in str(request)
    schema = request["generationConfig"]["responseJsonSchema"]
    assert "maxItems" not in schema["properties"]["mappings"]
    assert set(schema["$defs"]["FindingBodyMapping"]["properties"]["region_ids"]["items"]["enum"]) == set(
        body_map.ANATOMY_REGIONS
    )


@pytest.mark.parametrize(
    "findings,enabled,status",
    [([], True, "not_needed"), ([finding("carrier")], True, "not_needed"), ([finding()], False, "unavailable")],
)
def test_skips_unnecessary_or_disabled_calls(monkeypatch, findings, enabled, status):
    def forbidden(**_):
        raise AssertionError("No provider should be loaded")

    monkeypatch.setattr(body_map, "get_llm", forbidden)
    result = body_map.build_body_map(findings, enabled=enabled)
    assert result["status"] == status and result["mappings"] == []


@pytest.mark.parametrize(
    "reply",
    [
        {"mappings": [{"finding_index": 0, "region_ids": ["imaginary_organ"]}]},
        {"mappings": [{"finding_index": 0, "region_ids": ["liver", "liver"]}]},
        {"mappings": [{"finding_index": 1, "region_ids": ["liver"]}]},
        {"mappings": [{"finding_index": -1, "region_ids": ["liver"]}]},
        {"mappings": [{"finding_index": True, "region_ids": ["liver"]}]},
        {"mappings": [{"finding_index": 0, "region_ids": ["liver"], "diagnosis": "invented"}]},
        {"mappings": [{"finding_index": 0, "region_ids": ["liver"]}] * 2},
        {"mappings": []},
        ["liver"],
        "invalid json response",
    ],
)
def test_invalid_mapping_never_produces_partial_or_unrelated_highlights(monkeypatch, reply):
    configure(monkeypatch, reply)
    result = body_map.build_body_map([finding(), finding("carrier")], enabled=True)
    assert result["status"] == "unavailable" and result["mappings"] == []


def test_unrepresentable_condition_can_return_no_regions(monkeypatch):
    configure(monkeypatch, {"mappings": [{"finding_index": 0, "region_ids": []}]})
    assert body_map.build_body_map([finding()], enabled=True)["status"] == "mapped"


def test_missing_or_non_gemini_provider_is_unavailable(monkeypatch):
    for client in (None, object()):
        monkeypatch.setattr(body_map, "get_llm", lambda client=client, **_: client)
        assert body_map.build_body_map([finding()], enabled=True)["status"] == "unavailable"


def test_timeout_and_provider_errors_are_safe_and_not_retried(monkeypatch, caplog):
    session = configure(monkeypatch, {}, status=429)
    assert body_map.build_body_map([finding()], enabled=True)["status"] == "unavailable"
    assert len(session.calls) == 1

    def timeout(*args, **kwargs):
        raise requests.Timeout("PRIVATE_PROVIDER_PAYLOAD")

    monkeypatch.setattr(session, "post", timeout)
    assert body_map.build_body_map([finding()], enabled=True)["status"] == "unavailable"
    assert "PRIVATE_PROVIDER_PAYLOAD" not in caplog.text


def test_genome_only_analysis_explicitly_maps_without_enabling_symptom_extraction(database, monkeypatch):
    session = configure(monkeypatch, {"mappings": [{"finding_index": 0, "region_ids": ["digestive_tract"]}]})
    with db.session(database) as connection:
        analyzer = Analyzer(connection)
    report = analyzer.analyze(
        read_calls(vcf("PRIVATE_SAMPLE", [(1100, "1|0"), (1200, "0|1")])), "", None, False, map_body=True
    )
    assert report["symptoms"]["extraction"] == "keyword"
    assert report["body_map"]["status"] == "mapped" and len(session.calls) == 1
    assert public_report(report)["body_map"] == report["body_map"]
    assert "PRIVATE_SAMPLE" not in str(session.calls)
    del report["body_map"]
    assert "body_map" not in public_report(report)  # Historical jobs stay readable.
