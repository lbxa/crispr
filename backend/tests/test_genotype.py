from conftest import AD_VARIANT, alt_for, base

from crispr_backend import db
from crispr_backend.analysis.genotype import GenotypeStatus, VariantIndex, assess
from crispr_backend.vcf import Call


def call(pos: int, copies: int = 1, haplotypes=(0,), hemizygous=False) -> Call:
    return Call("16", pos, base(pos), alt_for(pos), copies, haplotypes, hemizygous)


def status(database, calls, sex="female"):
    with db.session(database) as connection:
        findings = assess(VariantIndex(connection), calls, sex)
    return {f.disease: f.status for f in findings}


def test_recessive_needs_both_copies(database):
    assert status(database, [call(1100, 2, (0, 1))]) == {"Familial Mediterranean fever": GenotypeStatus.AFFECTED}
    assert status(database, [call(1100)]) == {"Familial Mediterranean fever": GenotypeStatus.CARRIER}


def test_compound_heterozygous_depends_on_phase(database):
    trans = [call(1100, haplotypes=(0,)), call(1200, haplotypes=(1,))]
    cis = [call(1100, haplotypes=(0,)), call(1200, haplotypes=(0,))]
    unphased = [call(1100, haplotypes=()), call(1200, haplotypes=())]
    assert status(database, trans)["Familial Mediterranean fever"] is GenotypeStatus.AFFECTED
    assert status(database, cis)["Familial Mediterranean fever"] is GenotypeStatus.CARRIER
    assert status(database, unphased)["Familial Mediterranean fever"] is GenotypeStatus.AFFECTED


def test_dominant_needs_one_copy(database):
    assert status(database, [call(AD_VARIANT[1])]) == {"Achondroplasia": GenotypeStatus.AFFECTED}


def test_unknown_variants_are_ignored(database):
    assert status(database, [call(1101)]) == {}
