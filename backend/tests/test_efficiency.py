"""CRISPRon integration: 30-mer extraction, the advisability score, the service client and the HTTP service."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import pytest
from conftest import REGION_START, SEQUENCE, alt_for, base, vcf

from crispr_backend import efficiency
from crispr_backend.analysis.advisability import assess
from crispr_backend.analysis.crispr import find_guides, plan_edit
from crispr_backend.efficiency import Prediction
from crispr_backend.panel import Inheritance, Mechanism
from scoring_service import encoding, server, thermo

VARIANT = REGION_START + 203  # inside the seed of the guide whose PAM is planted at +205
ARGS = (SEQUENCE, REGION_START, VARIANT, base(VARIANT), alt_for(VARIANT))


def _guides_at(pos):
    return find_guides(SEQUENCE, REGION_START, pos, base(pos), alt_for(pos))


def test_contexts_are_30mers_with_the_guide_and_pam_in_place():
    guides = find_guides(*ARGS)
    with_context = [g for g in guides if g.context]
    assert with_context
    for guide in with_context:
        context = guide.context or ""
        assert len(context) == 30
        assert context[4:24] == guide.spacer and context[24:27] == guide.pam
        encoding.validate(context)  # NGG at the right offset, for both strands


def test_guides_without_room_for_context_are_kept_but_unscorable():
    pos = REGION_START + 2  # the region edge leaves no 5' context for early guides
    guides = find_guides(SEQUENCE, REGION_START, pos, base(pos), alt_for(pos))
    assert all(g.context is None or len(g.context) == 30 for g in guides)


def test_reverse_strand_context_is_the_reverse_complement_window():
    guide = next(
        g
        for pos in range(REGION_START + 60, REGION_START + 340, 7)
        for g in _guides_at(pos)
        if g.strand == "-" and g.context
    )
    context = guide.context or ""
    assert context[4:24] == guide.spacer and context[24:27] == guide.pam and guide.pam.endswith("GG")


def fake_predictions(contexts):
    return [
        Prediction(
            float(10 + 20 * i), {"1.model.best": 9.0 + 20 * i, "2.model.best": 11.0 + 20 * i}, {"crisproff_score": 20.0}
        )
        for i in range(len(contexts))
    ]


def test_scorer_attaches_efficiency_and_advisability_without_reordering():
    args = (*ARGS, Inheritance.AUTOSOMAL_RECESSIVE, Mechanism.LOSS_OF_FUNCTION)
    plain = plan_edit(*args)
    plan = plan_edit(*args, scorer=fake_predictions)
    assert all(
        g.model_scores and g.energy == {"crisproff_score": 20.0} for g in plan.guides if g.efficiency is not None
    )
    assert [g.spacer for g in plan.guides] == [g.spacer for g in plain.guides]
    assert plan.advisability and plan.advisability.score == max(g.efficiency for g in plan.guides if g.efficiency)
    assert plain.advisability is None


def test_scorer_failure_yields_unavailable_not_an_error():
    plan = plan_edit(*ARGS, Inheritance.AUTOSOMAL_RECESSIVE, Mechanism.LOSS_OF_FUNCTION, scorer=lambda c: None)
    assert plan.advisability and plan.advisability.band == "unavailable" and plan.advisability.score is None


@pytest.mark.parametrize(("value", "band"), [(75.0, "high"), (45.0, "moderate"), (12.0, "low")])
def test_bands(value, band):
    guides = find_guides(*ARGS)[:1]
    guides = [type(guides[0])(**{**guides[0].__dict__, "efficiency": value})]
    result = assess(guides, strategy="Homology-directed repair (correction)")
    assert result.band == band and result.score == value
    assert ("homology-directed" in result.basis) == True  # noqa: E712


def test_client_posts_contexts_and_tolerates_failures(monkeypatch):
    class Reply:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self.payload

    monkeypatch.setenv("CRISPRON_URL", "http://scorer:8001/")
    scorer = efficiency.get_scorer()
    assert scorer
    sent = []
    reply = {
        "predictions": [{"efficiency": 41.5, "models": {"1.model.best": 40.0}, "energy": {"crisproff_score": 21.5}}]
    }
    monkeypatch.setattr(
        efficiency.requests, "post", lambda url, json, timeout: sent.append((url, json)) or Reply(reply)
    )
    assert scorer(["A" * 30]) == [Prediction(41.5, {"1.model.best": 40.0}, {"crisproff_score": 21.5})]
    assert sent == [("http://scorer:8001/score", {"contexts": ["A" * 30]})]
    monkeypatch.setattr(efficiency.requests, "post", lambda url, json, timeout: Reply({"predictions": []}))
    assert scorer(["A" * 30]) is None  # wrong length
    monkeypatch.delenv("CRISPRON_URL")
    assert efficiency.get_scorer() is None


GOOD = "ACGT" + "GACGTACGTACGTACGTACG" + "TGG" + "ACG"


def test_one_hot_shape_and_order():
    [matrix] = encoding.one_hot([GOOD])
    assert len(matrix) == 30 and all(sum(row) == 1.0 for row in matrix)
    assert matrix[0] == [1.0, 0, 0, 0] and matrix[1] == [0, 1.0, 0, 0]  # A, C
    with pytest.raises(ValueError):
        encoding.validate(GOOD[:-1])
    with pytest.raises(ValueError):
        encoding.validate(GOOD[:25] + "AA" + GOOD[27:])  # no NGG PAM
    assert encoding.guide_with_pam(GOOD) == GOOD[4:27]


HEADER = "guideID\tguideSeq\tRNA_DNA_eng\tRNA_DNA_eng_weighted\tDNA_DNA_opening\tspacer_self_fold\tCRISPRoff_score"


def test_crisproff_energy_terms_are_read_by_column():
    text = HEADER + "\ng0\tSEQ\t-28.4\t-49.6\t26.99\t-1.8\t20.8\n"
    assert thermo.parse_params(text) == [
        {
            "rna_dna": -28.4,
            "rna_dna_weighted": -49.6,
            "dna_opening": 26.99,
            "spacer_self_fold": -1.8,
            "crisproff_score": 20.8,
        }
    ]
    with pytest.raises(RuntimeError, match="unexpected CRISPRoff output"):
        thermo.parse_params(text.replace("CRISPRoff_score", "something_else"))


def test_http_service_scores_and_rejects_bad_input():
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        server.make_handler(
            lambda contexts: (
                [{"efficiency": 50.004, "models": {"a": 49.0}, "energy": {"crisproff_score": 1.23456}}] * len(contexts)
            )
        ),
    )
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_port}/score"

    def post(body):
        try:
            with urlopen(Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})) as response:
                return response.status, json.load(response)
        except Exception as error:  # urllib raises HTTPError for 4xx
            return error.code, json.load(error)  # pyright: ignore

    try:
        one = {"efficiency": 50.0, "models": {"a": 49.0}, "energy": {"crisproff_score": 1.235}}
        assert post({"contexts": [GOOD, GOOD]}) == (200, {"predictions": [one, one]})
        assert post({"contexts": ["ACGT"]})[0] == 400
        assert post({"nope": 1})[0] == 400
    finally:
        httpd.shutdown()


def test_gene_endpoints_plan_by_name_and_score(database, monkeypatch):
    from fastapi.testclient import TestClient

    from crispr_backend.api import app

    monkeypatch.setattr("crispr_backend.analysis.pipeline.get_scorer", lambda: fake_predictions)
    with TestClient(app) as client:
        genes = {g["gene"]: g for g in client.get("/genes").json()}
        assert set(genes) == {"MEFV", "FGFR3"} and genes["MEFV"]["variants"] == 3
        assert genes["FGFR3"]["mechanism"] == "gain_of_function"

        plan = client.get("/genes/mefv/crispr").json()  # case-insensitive
        assert plan["gene"] == "MEFV" and len(plan["edits"]) == 2
        edit = plan["edits"][0]
        assert edit["advisability"]["score"] is not None and edit["guides"][0]["model_scores"]
        assert edit["disease"] == "Familial Mediterranean fever"

        one = client.get("/genes/MEFV/crispr", params={"variation_id": 3}).json()
        assert [e["variation_id"] for e in one["edits"]] == [3]
        assert client.get("/genes/FGFR3/crispr").json()["edits"][0]["strategy"] == "Allele-specific knockout"

        assert client.get("/genes/NOPE/crispr").status_code == 404
        assert client.get("/genes/MEFV/crispr", params={"variation_id": 4}).status_code == 404  # an FGFR3 variant
        assert client.get("/genes/MEFV/crispr", params={"max_variants": 0}).status_code == 422


def _edit(score, variant="v"):
    return {"variant": variant, "advisability": {"score": score, "band": "moderate"} if score is not None else None}


def test_overview_verdict_follows_the_threshold(monkeypatch):
    from crispr_backend.analysis.advisability import overview

    monkeypatch.delenv("CRISPR_ADVISE_THRESHOLD", raising=False)
    best = overview([("MEFV", _edit(45.0, "a")), ("MEFV", _edit(55.0, "b"))])
    assert (
        best["verdict"] == "recommended" and best["score"] == 55.0 and best["target"] == "b" and best["gene"] == "MEFV"
    )
    assert best["threshold"] == 50.0 and "advisable" in best["headline"]
    assert overview([("MEFV", _edit(49.9))])["verdict"] == "not_recommended"
    assert overview([("MEFV", _edit(50.0))])["verdict"] == "recommended"  # at the threshold counts
    monkeypatch.setenv("CRISPR_ADVISE_THRESHOLD", "60")
    assert overview([("MEFV", _edit(55.0))])["verdict"] == "not_recommended"
    monkeypatch.setenv("CRISPR_ADVISE_THRESHOLD", "garbage")
    assert overview([("MEFV", _edit(55.0))])["threshold"] == 50.0


def test_overview_handles_missing_scores_and_no_edits():
    from crispr_backend.analysis.advisability import overview

    assert overview([])["verdict"] == "no_edit"
    unavailable = overview([("MEFV", _edit(None))])
    assert unavailable["verdict"] == "unavailable" and unavailable["score"] is None


def test_report_and_gene_plan_carry_an_overview(database, monkeypatch):
    from fastapi.testclient import TestClient

    from crispr_backend.api import app

    monkeypatch.setattr("crispr_backend.analysis.pipeline.get_scorer", lambda: fake_predictions)
    with TestClient(app) as client:
        report = client.post(
            "/analyze",
            json={"vcf": vcf("S", [(1100, "1|0"), (1200, "0|1")]), "symptoms": "recurrent fever", "use_llm": False},
        ).json()
        carrier = client.post("/analyze", json={"vcf": vcf("S", [(1150, "0|1")]), "use_llm": False}).json()
        gene = client.get("/genes/MEFV/crispr").json()
    assert report["overview"]["verdict"] in ("recommended", "not_recommended") and report["overview"][
        "target"
    ].startswith("MEFV")
    assert carrier["overview"]["verdict"] == "no_edit"
    assert gene["overview"]["score"] == max(e["advisability"]["score"] for e in gene["edits"])
