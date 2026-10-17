"""Minimal single-sample VCF reading and writing.

Pure Python on purpose: htslib bindings need compiling on s390x, and the panel
genomes are small enough to parse line by line.
"""

import gzip
import io
from dataclasses import dataclass


@dataclass(frozen=True)
class Call:
    """One alternate allele observed in the sample."""

    chrom: str  # without "chr" prefix
    pos: int
    ref: str
    alt: str
    alt_copies: int  # 1 = heterozygous, 2 = homozygous (or 1 for hemizygous)
    haplotypes: tuple[int, ...]  # phased haplotype indexes carrying the allele; () if unphased
    hemizygous: bool = False


def normalize_chrom(chrom: str) -> str:
    return chrom.removeprefix("chr")


def parse_genotype(genotype: str, alt_index: int) -> tuple[int, tuple[int, ...], bool]:
    """Return (copies of alt_index, phased haplotypes carrying it, hemizygous)."""
    phased = "|" in genotype
    alleles = genotype.replace("|", "/").split("/")
    copies = sum(1 for allele in alleles if allele == str(alt_index))
    haplotypes = tuple(i for i, allele in enumerate(alleles) if allele == str(alt_index)) if phased else ()
    return copies, haplotypes, len(alleles) == 1


def read_calls(text: str) -> list[Call]:
    """Parse VCF text into calls for the first sample, skipping reference-only genotypes."""
    calls = []
    for line in io.StringIO(text):
        if line.startswith("#") or not line.strip():
            continue
        fields = line.rstrip("\n").split("\t")
        if len(fields) < 10:
            raise ValueError("VCF has no sample column")
        chrom, pos, _id, ref, alts, _qual, filt, _info, fmt, sample = fields[:10]
        if filt not in ("PASS", ".", ""):
            continue
        keys = fmt.split(":")
        values = sample.split(":")
        genotype = values[keys.index("GT")] if "GT" in keys else values[0]
        for index, alt in enumerate(alts.split(","), start=1):
            copies, haplotypes, hemizygous = parse_genotype(genotype, index)
            if copies:
                calls.append(
                    Call(normalize_chrom(chrom), int(pos), ref.upper(), alt.upper(), copies, haplotypes, hemizygous)
                )
    return calls


def read_calls_gz(blob: bytes) -> list[Call]:
    return read_calls(gzip.decompress(blob).decode())
