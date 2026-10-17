from copy import deepcopy

import pytest
from conftest import REGION_START, SEQUENCE, vcf

from crispr_backend import db
from crispr_backend.analysis.genome_view import CHROMOSOME_LENGTHS, build_genome_view
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.uploads.service import public_report
from crispr_backend.vcf import read_calls


def finding(pos=1100, ref="A", alt="T", gene="GENE", tier="possible"):
    return {
        "gene": gene,
        "disease": "Example condition",
        "tier": tier,
        "variants": [
            {
                "variation_id": 1,
                "chrom": "16",
                "pos": pos,
                "ref": ref,
                "alt": alt,
                "significance": "Pathogenic",
                "zygosity": "heterozygous",
            }
        ],
    }


def test_analyzed_upload_exposes_exact_coordinates_context_and_carrier_tier(database):
    with db.session(database) as connection:
        report = Analyzer(connection).analyze(read_calls(vcf("PRIVATE_SAMPLE", [(1100, "0/1")])), "", None, False)
    projected = public_report(report)
    view = projected["genome_view"]
    assert view["assembly"] == "GRCh38" and view["coordinate_system"] == "zero-based-half-open"
    assert view["version"] == 1 and len(view["chromosomes"]) == 25
    region = view["regions"][0]
    assert (region["chromosome"], region["start"], region["end"]) == ("16", 1099, 1100)
    assert region["annotations"][0]["tier"] == "carrier"
    context = region["reference_context"]
    assert context["start"] == REGION_START - 1
    assert context["end"] - context["start"] == len(context["bases"])
    assert context["bases"] == SEQUENCE[: context["end"] - context["start"]]
    assert context["bases"][region["start"] - context["start"]] == region["reference"]
    assert "symptoms" not in projected and "variants" not in projected["findings"][0]
    assert "PRIVATE_SAMPLE" not in str(projected)


@pytest.mark.parametrize("ref,alt", [("A", "T"), ("ACT", "A"), ("A", "ACGT")])
def test_snv_and_indels_keep_the_reference_span_and_separate_alternate(ref, alt):
    source = finding(pos=1, ref=ref, alt=alt)
    region = build_genome_view([source], {})["regions"][0]
    assert (region["start"], region["end"]) == (0, len(ref))
    assert region["alternate"] == alt
    assert region["reference_context"] is None


def test_shared_allele_deduplicates_disease_annotations_without_mutating_inputs():
    first = finding()
    other = finding(gene="OTHER", tier="carrier")
    original = deepcopy([first, other])
    result = build_genome_view([first, first, other], {})
    assert len(result["regions"]) == 1
    assert len(result["regions"][0]["annotations"]) == 2
    assert original == [first, other]
    alternate = finding(alt="G")
    alternate["variants"][0]["variation_id"] = 2
    assert len(build_genome_view([first, alternate], {})["regions"]) == 2


def test_chromosome_edges_and_missing_or_inconsistent_reference():
    end = CHROMOSOME_LENGTHS["16"]
    region = build_genome_view([finding(pos=end)], {})["regions"][0]
    assert region["end"] == end
    with pytest.raises(ValueError, match="outside"):
        build_genome_view([finding(pos=end, ref="AT")], {})
    source = {"GENE": {"chrom": "16", "start": 1099, "end": 1101, "sequence": "CCC"}}
    assert build_genome_view([finding()], source)["regions"][0]["reference_context"] is None
    source["GENE"]["sequence"] = "CAT"
    context = build_genome_view([finding()], source)["regions"][0]["reference_context"]
    assert context == {"start": 1098, "end": 1101, "bases": "CAT"}


def test_no_findings_has_an_empty_map_and_legacy_reports_remain_readable(database):
    with db.session(database) as connection:
        report = Analyzer(connection).analyze([], "", None, False)
    assert report["genome_view"]["regions"] == []
    del report["genome_view"]
    assert "genome_view" not in public_report(report)
