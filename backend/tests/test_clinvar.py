"""Tests for the ClinVar import in etl/build_reference.py.

Offline by default. The `network` tests query live ClinVar/NCBI to catch format
changes in new ClinVar releases: `.venv/bin/python -m pytest -m network`.
"""

import pytest
import requests

from etl import build_reference as ref

CFTR, CF = "CFTR", "OMIM:219700"
# CLNDISDB as ClinVar writes it for F508del: '|' separates conditions, ',' separates IDs.
F508DEL_DISDB = (
    ".|MONDO:MONDO:0008185,MedGen:C0238339,OMIM:167800,Orphanet:676"
    "|MONDO:MONDO:0009061,MedGen:C0010674,OMIM:219700,Orphanet:586"
)


def record(
    *,
    variation_id="7105",
    chrom="7",
    pos="117559590",
    ref_allele="ATCT",
    alt="A",
    clnsig: str | None = "Pathogenic",
    revstat: str | None = "practice_guideline",
    geneinfo: str | None = "CFTR:1080",
    disdb: str | None = F508DEL_DISDB,
    clnvc: str | None = "Deletion",
    rs: str | None = "113993960",
) -> str:
    info = {
        "CLNDISDB": disdb,
        "CLNREVSTAT": revstat,
        "CLNSIG": clnsig,
        "CLNVC": clnvc,
        "GENEINFO": geneinfo,
        "RS": rs,
    }
    info_text = ";".join(f"{key}={value}" for key, value in info.items() if value is not None)
    return "\t".join([chrom, pos, variation_id, ref_allele, alt, ".", ".", info_text]) + "\n"


def parse(line: str, gene: str = CFTR, omim_ids=(CF,)):
    return ref.parse_clinvar_record(line, gene, list(omim_ids))


def kept(line: str, gene: str = CFTR, omim_ids=(CF,)) -> dict:
    variant = parse(line, gene, omim_ids)
    assert variant is not None, "expected the record to be kept"
    return variant


# --- parse_clinvar_record ---------------------------------------------------------------


def test_keeps_a_pathogenic_variant_and_reads_every_field():
    assert parse(record()) == {
        "variation_id": 7105,
        "omim_id": CF,
        "gene": CFTR,
        "chrom": "7",
        "pos": 117559590,
        "ref": "ATCT",
        "alt": "A",
        "significance": "Pathogenic",
        "stars": 4,
        "variant_type": "Deletion",
        "rsid": "rs113993960",
    }


@pytest.mark.parametrize("clnsig", ["Pathogenic", "Likely_pathogenic", "Pathogenic/Likely_pathogenic"])
def test_accepts_pathogenic_classifications(clnsig):
    assert kept(record(clnsig=clnsig))["significance"] == clnsig


@pytest.mark.parametrize(
    "clnsig",
    [
        "Benign",
        "Likely_benign",
        "Uncertain_significance",
        "Conflicting_classifications_of_pathogenicity",
        "drug_response",
        None,
    ],
)
def test_rejects_other_classifications(clnsig):
    assert parse(record(clnsig=clnsig)) is None


def test_rejects_variants_in_other_genes_but_accepts_multi_gene_records():
    assert parse(record(geneinfo="CFTR-AS1:107986988")) is None
    assert parse(record(geneinfo="CFTR:1080|CFTR-AS1:107986988")) is not None


def test_requires_a_link_to_a_panel_disease():
    assert parse(record(disdb="MONDO:MONDO:0008185,OMIM:167800")) is None
    assert parse(record(disdb=None)) is None
    # Exact ID match: a longer OMIM number that starts with the same digits is a different disease.
    assert parse(record(disdb="OMIM:2197001")) is None
    assert kept(record(), omim_ids=("OMIM:167800", CF))["omim_id"] == "OMIM:167800"


@pytest.mark.parametrize(
    ("ref_allele", "alt"),
    [("A" * 51, "A"), ("A", "A" * 51), ("A", "<DEL>"), ("N", "A"), ("A", ".")],
)
def test_rejects_large_symbolic_or_ambiguous_alleles(ref_allele, alt):
    assert parse(record(ref_allele=ref_allele, alt=alt)) is None


def test_accepts_alleles_at_the_size_limit():
    assert parse(record(ref_allele="A" * 50, alt="A")) is not None


def test_missing_rsid_is_none():
    assert kept(record(rs=None))["rsid"] is None


# --- review stars -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("revstat", "stars"),
    [
        ("practice_guideline", 4),
        ("reviewed_by_expert_panel", 3),
        ("criteria_provided,_multiple_submitters,_no_conflicts", 2),
        ("criteria_provided,_single_submitter", 1),
        ("criteria_provided,_conflicting_classifications", 1),
        ("no_assertion_criteria_provided", 0),
        ("no_classification_provided", 0),
        (None, 0),
    ],
)
def test_review_status_maps_to_clinvar_stars(revstat, stars):
    assert kept(record(revstat=revstat))["stars"] == stars


def test_disease_ids_splits_conditions_and_ids():
    assert ref.disease_ids(F508DEL_DISDB) == {
        ".",
        "MONDO:MONDO:0008185",
        "MedGen:C0238339",
        "OMIM:167800",
        "Orphanet:676",
        "MONDO:MONDO:0009061",
        "MedGen:C0010674",
        "OMIM:219700",
        "Orphanet:586",
    }
    assert ref.disease_ids("") == set()


# --- clinvar_variants (tabix fetch) -----------------------------------------------------


class FakeTabix:
    def __init__(self, lines):
        self.lines, self.fetched = lines, None

    def __call__(self, url, index, encoding):
        assert url == ref.CLINVAR_VCF and encoding == "utf-8"
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def fetch(self, chrom, start, end):
        self.fetched = (chrom, start, end)
        return iter(self.lines)


def test_clinvar_variants_queries_the_gene_region_and_filters(monkeypatch, tmp_path):
    fake = FakeTabix([record(), record(variation_id="1", clnsig="Benign"), record(variation_id="2", geneinfo="X:1")])
    monkeypatch.setattr(ref.pysam, "TabixFile", fake)
    monkeypatch.setattr(ref, "download", lambda url, path: tmp_path / "clinvar.vcf.gz.tbi")
    region = {"gene": CFTR, "chrom": "7", "start": 117_285_120, "end": 117_717_971}
    disease = type("Disease", (), {"omim_id": CF})()

    variants = ref.clinvar_variants(region, [disease])

    assert fake.fetched == ("7", 117_285_119, 117_717_971)  # tabix is 0-based, half-open
    assert [v["variation_id"] for v in variants] == [7105]


# --- variant_names (NCBI E-utilities) ---------------------------------------------------


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


def test_variant_names_batches_requests_and_reads_titles(monkeypatch):
    batches = []

    def fake_post(url, data, timeout):
        assert url.endswith("/esummary.fcgi") and data["db"] == "clinvar"
        ids = data["id"].split(",")
        batches.append(len(ids))
        return FakeResponse({"result": {"uids": ids, **{i: {"title": f"variant {i}"} for i in ids}}})

    monkeypatch.setattr(ref.requests, "post", fake_post)
    monkeypatch.setattr(ref.time, "sleep", lambda seconds: None)

    names = ref.variant_names(list(range(1, 451)))

    assert batches == [200, 200, 50]
    assert len(names) == 450 and names[7] == "variant 7"


def test_variant_names_tolerates_missing_records_and_surfaces_http_errors(monkeypatch):
    monkeypatch.setattr(ref.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(ref.requests, "post", lambda *a, **k: FakeResponse({"result": {"uids": []}}))
    assert ref.variant_names([1, 2]) == {}
    monkeypatch.setattr(ref.requests, "post", lambda *a, **k: FakeResponse({}, status=503))
    with pytest.raises(requests.HTTPError):
        ref.variant_names([1])


# --- live ClinVar (opt-in) --------------------------------------------------------------


@pytest.mark.network
def test_live_clinvar_still_has_f508del_in_the_expected_format():
    region = {"gene": CFTR, "chrom": "7", "start": 117_559_580, "end": 117_559_600}
    disease = type("Disease", (), {"omim_id": CF})()
    f508del = next(v for v in ref.clinvar_variants(region, [disease]) if v["variation_id"] == 7105)
    assert (f508del["pos"], f508del["ref"], f508del["alt"]) == (117_559_590, "ATCT", "A")
    assert f508del["significance"] in ref.PATHOGENIC and f508del["stars"] >= 3
    assert "Phe508del" in ref.variant_names([7105])[7105]
