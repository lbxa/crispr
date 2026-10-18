import pytest

from crispr_backend.vcf import parse_genotype, read_calls

HEADER = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n"


def test_parse_genotype_phased_unphased_and_hemizygous():
    assert parse_genotype("0|1", 1) == (1, (1,), False)
    assert parse_genotype("1|1", 1) == (2, (0, 1), False)
    assert parse_genotype("0/1", 1) == (1, (), False)
    assert parse_genotype("1", 1) == (1, (), True)


def test_read_calls_skips_reference_and_failed_records_and_splits_alleles():
    text = HEADER + "\n".join(
        [
            "chr7\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0|1",
            "chr7\t200\t.\tC\tT\t.\tPASS\t.\tGT\t0|0",
            "chr7\t300\t.\tG\tA\t.\tLowQual\t.\tGT\t1|1",
            "chrX\t400\t.\tT\tC,G\t.\t.\t.\tGT:DP\t2:30",
        ]
    )
    calls = read_calls(text)
    assert [(c.chrom, c.pos, c.alt, c.alt_copies) for c in calls] == [("7", 100, "G", 1), ("X", 400, "G", 1)]
    assert calls[1].hemizygous


def test_read_calls_requires_a_sample_column():
    with pytest.raises(ValueError):
        read_calls("chr1\t1\t.\tA\tG\t.\tPASS\t.\n")


def test_with_sample_sex_adds_metadata_once_before_the_column_header():
    from crispr_backend.vcf import with_sample_sex

    text = HEADER + "chr7\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0|1\n"
    tagged = with_sample_sex(text, "S1", "male")
    lines = tagged.splitlines()
    assert lines[lines.index("##SAMPLE=<ID=S1,Sex=male>") + 1].startswith("#CHROM")
    assert with_sample_sex(tagged, "S1", "female") == tagged  # existing metadata wins
    assert with_sample_sex("no header", "S1", "male") == "no header"
