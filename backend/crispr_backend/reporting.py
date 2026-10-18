"""Read-only projections of saved analysis evidence for consumers and laboratories."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

from crispr_backend.analysis.advisability import Advisability, overview
from crispr_backend.analysis.crispr import Guide
from crispr_backend.analysis.genotype import VariantHit


class LabEdit(BaseModel):
    variation_id: int
    variant: str | None
    strategy: str
    rationale: str
    guides: list[Guide]
    alternative: str
    off_target: str
    advisability: Advisability | None = None
    repair_template: str | None = None
    repair_template_notes: str | None = None


class GenotypeEvidence(BaseModel):
    status: str
    explanation: str


class LabFinding(BaseModel):
    tier: Literal["likely", "possible", "carrier"]
    gene: str
    disease: str
    omim_id: str | None = None
    inheritance: str | None = None
    genotype: GenotypeEvidence | None = None
    variants: list[VariantHit] = Field(default_factory=list)
    crispr: list[LabEdit] = Field(default_factory=list)


class GenomeEvidence(BaseModel):
    variants_checked: int = Field(ge=0)
    panel_genes: list[str]


class Conclusion(BaseModel):
    status: str
    label: str


class AnalysisSummary(BaseModel):
    text: str


class LabAnalysis(BaseModel):
    conclusion: Conclusion
    summary: AnalysisSummary
    genome: GenomeEvidence
    findings: list[LabFinding]
    disclaimer: str


@dataclass(frozen=True)
class LabReport:
    upload_id: str
    analyzed_at: str
    sha256: str
    records_scanned: int
    analysis: LabAnalysis


def gene_plans(report: dict) -> list[dict]:
    """Use only the uploaded genome's non-carrier edits; never look up catalog variants."""
    grouped: dict[str, list[dict]] = {}
    for finding in report["findings"]:
        if finding["tier"] == "carrier" or "crispr" not in finding:
            continue
        edits = grouped.setdefault(finding["gene"], [])
        edits.extend({**edit, "disease": finding["disease"]} for edit in finding.get("crispr", []))
    return [
        {
            "gene": gene,
            "overview": overview(
                [(gene, edit) for edit in edits],
                cutoff=next(
                    (edit["advisability"]["threshold"] for edit in edits if edit.get("advisability")),
                    report.get("overview", {}).get("threshold"),
                ),
            ),
            "edits": edits,
            "disclaimer": report["disclaimer"],
        }
        for gene, edits in grouped.items()
    ]
