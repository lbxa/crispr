"""Match a genome's calls against known pathogenic variants and apply inheritance rules."""

import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum

from crispr_backend.panel import Inheritance
from crispr_backend.vcf import Call


class GenotypeStatus(StrEnum):
    AFFECTED = "affected"  # genotype is sufficient to cause the disease
    CARRIER = "carrier"  # one copy of a recessive variant: not expected to cause symptoms


@dataclass(frozen=True)
class VariantHit:
    variation_id: int
    name: str | None
    rsid: str | None
    chrom: str
    pos: int
    ref: str
    alt: str
    significance: str
    stars: int
    zygosity: str  # 'heterozygous' | 'homozygous' | 'hemizygous'
    haplotypes: tuple[int, ...]


@dataclass
class GenotypeFinding:
    omim_id: str
    disease: str
    gene: str
    inheritance: Inheritance
    mechanism: str
    status: GenotypeStatus
    explanation: str
    hits: list[VariantHit] = field(default_factory=list)


Locus = tuple[str, int, str, str]


class VariantIndex:
    """In-memory lookup of ClinVar pathogenic variants by exact locus."""

    def __init__(self, connection: sqlite3.Connection):
        self.by_locus: dict[Locus, list[sqlite3.Row]] = defaultdict(list)
        for row in connection.execute("SELECT * FROM variants"):
            self.by_locus[(row["chrom"], row["pos"], row["ref"], row["alt"])].append(row)
        self.diseases = {row["omim_id"]: row for row in connection.execute("SELECT * FROM diseases")}

    def match(self, calls: list[Call]) -> dict[str, list[tuple[sqlite3.Row, Call]]]:
        """omim_id -> [(variant row, call)] for every call that is a known pathogenic variant."""
        matches: dict[str, list[tuple[sqlite3.Row, Call]]] = defaultdict(list)
        for call in calls:
            for row in self.by_locus.get((call.chrom, call.pos, call.ref, call.alt), []):
                matches[row["omim_id"]].append((row, call))
        return matches


def zygosity(call: Call) -> str:
    if call.hemizygous:
        return "hemizygous"
    return "homozygous" if call.alt_copies >= 2 else "heterozygous"


def biallelic(calls: list[Call]) -> tuple[bool, str]:
    """Do the calls hit both copies of a gene? Returns (affected, explanation)."""
    if any(call.alt_copies >= 2 for call in calls):
        return True, "homozygous for a pathogenic variant"
    if len(calls) < 2:
        return False, "one pathogenic copy (carrier)"
    haplotype_sets = [set(call.haplotypes) for call in calls]
    if all(haplotype_sets) and len(set().union(*haplotype_sets)) == 1:
        return False, "two pathogenic variants on the same copy of the gene (cis), so one working copy remains"
    if all(haplotype_sets):
        return True, "compound heterozygous: pathogenic variants on both copies of the gene"
    return True, "two pathogenic variants (phase unknown; assumed on different copies)"


def assess(index: VariantIndex, calls: list[Call], sex: str | None) -> list[GenotypeFinding]:
    findings = []
    for omim_id, matched in index.match(calls).items():
        disease = index.diseases[omim_id]
        inheritance = Inheritance(disease["inheritance"])
        hit_calls = [call for _row, call in matched]
        male = sex == "male" or (sex is None and any(call.hemizygous for call in hit_calls))

        if inheritance in (Inheritance.AUTOSOMAL_DOMINANT, Inheritance.X_LINKED_DOMINANT):
            affected, explanation = True, "one pathogenic copy is enough for this dominant condition"
        elif inheritance is Inheritance.X_LINKED_RECESSIVE and male:
            affected, explanation = True, "pathogenic variant on the only X chromosome (male)"
        else:
            affected, explanation = biallelic(hit_calls)

        findings.append(
            GenotypeFinding(
                omim_id=omim_id,
                disease=disease["name"],
                gene=disease["gene"],
                inheritance=inheritance,
                mechanism=disease["mechanism"],
                status=GenotypeStatus.AFFECTED if affected else GenotypeStatus.CARRIER,
                explanation=explanation,
                hits=[
                    VariantHit(
                        variation_id=row["variation_id"],
                        name=row["name"],
                        rsid=row["rsid"],
                        chrom=row["chrom"],
                        pos=row["pos"],
                        ref=row["ref"],
                        alt=row["alt"],
                        significance=row["significance"],
                        stars=row["stars"],
                        zygosity=zygosity(call),
                        haplotypes=call.haplotypes,
                    )
                    for row, call in matched
                ],
            )
        )
    return findings
