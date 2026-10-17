import pytest
from conftest import REGION_START, SEQUENCE, alt_for, base

from crispr_backend.analysis.crispr import base_editing_option, find_guides, plan_edit, reverse_complement
from crispr_backend.panel import Inheritance, Mechanism

PAM_START = REGION_START + 205  # conftest plants "AGG" at this position


def test_reverse_complement():
    assert reverse_complement("AACGTT") == "AACGTT"
    assert reverse_complement("ATGC") == "GCAT"


def test_guides_respect_spcas9_rules():
    variant = PAM_START - 2  # inside the seed of the planted PAM's guide
    guides = find_guides(SEQUENCE, REGION_START, variant, base(variant), alt_for(variant))
    assert guides, "expected at least one guide near the planted PAM"
    for guide in guides:
        assert len(guide.spacer) == 20 and guide.pam.endswith("GG")
        assert "TTTT" not in guide.spacer and guide.cut_distance <= 20
    assert guides == sorted(guides, key=lambda g: g.score, reverse=True)
    planted = [g for g in guides if g.strand == "+" and g.cut_position == PAM_START - 4]
    assert planted and planted[0].allele_specific and planted[0].spacer[-2] == alt_for(variant)


def test_reference_mismatch_is_rejected():
    pos = REGION_START + 50
    with pytest.raises(ValueError):
        find_guides(SEQUENCE, REGION_START, pos, alt_for(pos), base(pos))


def test_strategy_follows_disease_mechanism():
    variant = PAM_START - 2
    args = (SEQUENCE, REGION_START, variant, base(variant), alt_for(variant))
    recessive = plan_edit(*args, Inheritance.AUTOSOMAL_RECESSIVE, Mechanism.LOSS_OF_FUNCTION)
    assert recessive.strategy.startswith("Homology-directed repair")
    assert base(variant) in recessive.repair_template and len(recessive.repair_template) == 121
    gain = plan_edit(*args, Inheritance.AUTOSOMAL_DOMINANT, Mechanism.GAIN_OF_FUNCTION)
    assert gain.strategy == "Allele-specific knockout" and all(g.allele_specific for g in gain.guides)


def test_base_editing_suggestions():
    assert "Adenine base editor" in base_editing_option(ref="G", alt="A")
    assert "Cytosine base editor" in base_editing_option(ref="A", alt="G")
    assert "prime editing" in base_editing_option(ref="A", alt="T")
    assert "Prime editing" in base_editing_option(ref="AT", alt="A")
