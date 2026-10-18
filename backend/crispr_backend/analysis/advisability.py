"""CRISPR advisability: how worthwhile a Cas9 edit looks, from CRISPRon's predicted efficiency.

The score is the highest CRISPRon efficiency (predicted indel frequency, 0-100) among the
guides in the edit plan. CRISPRon models how often SpCas9 cuts and the cell repairs by
non-homologous end joining at a target, so it is a direct measure for knockouts and only an
upper bound on cutting for homology-directed correction. It says nothing about off-target
activity. Band thresholds are provisional until checked against the deployed model's outputs.
"""

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from crispr_backend.analysis.crispr import Guide

HIGH = 60.0
MODERATE = 40.0
DEFAULT_THRESHOLD = 50.0  # provisional: set CRISPR_ADVISE_THRESHOLD once real gene scores have been reviewed

BASIS = (
    "Highest CRISPRon-predicted SpCas9 indel frequency among the proposed guides. It measures cutting, "
    "not the chance of a successful correction, and does not assess off-target activity."
)
HDR_NOTE = " For homology-directed repair, the share of cut cells that are corrected is typically much lower."


def threshold() -> float:
    """Minimum score at which CRISPR is advised. Read per call so it can be tuned without a restart."""
    try:
        return float(os.environ.get("CRISPR_ADVISE_THRESHOLD", DEFAULT_THRESHOLD))
    except ValueError:
        return DEFAULT_THRESHOLD


@dataclass(frozen=True)
class Advisability:
    score: float | None  # 0-100; None when CRISPRon was unavailable or no guide could be scored
    band: str  # high | moderate | low | unavailable
    label: str
    best_guide: str | None  # spacer of the guide that sets the score
    guides_scored: int
    guides_skipped: int  # too close to the gene-region edge for a 30-nt context, or not scored
    basis: str
    threshold: float = DEFAULT_THRESHOLD
    recommended: bool | None = None  # score >= threshold; None when there is no score


def band_for(score: float) -> str:
    return "high" if score >= HIGH else "moderate" if score >= MODERATE else "low"


def assess(guides: "list[Guide] | None", skipped: int = 0, strategy: str | None = None) -> Advisability:
    scored = [g for g in guides or [] if g.efficiency is not None]
    if guides == []:
        return Advisability(
            None, "unavailable", "No suitable CRISPR guide found", None, 0, skipped, BASIS, threshold(), None
        )
    if not scored:
        return Advisability(
            None, "unavailable", "Efficiency prediction unavailable", None, 0, skipped, BASIS, threshold(), None
        )
    best = max(scored, key=lambda g: g.efficiency or 0.0)
    score = round(best.efficiency or 0.0, 1)
    band = band_for(score)
    label = {
        "high": "CRISPR editing is well supported",
        "moderate": "CRISPR editing is feasible but less efficient",
        "low": "CRISPR editing is predicted to be inefficient",
    }[band]
    basis = BASIS + (HDR_NOTE if strategy and strategy.startswith("Homology") else "")
    cutoff = threshold()
    return Advisability(score, band, label, best.spacer, len(scored), skipped, basis, cutoff, score >= cutoff)


def overview(edits: "list[tuple[str, dict]]", *, cutoff: float | None = None) -> dict:
    """One verdict across edit plans, from the best score against the threshold.

    `edits` are (gene, edit) pairs, where an edit is a plan dict carrying an `advisability` entry.
    verdict: recommended | not_recommended | unavailable (no score) | no_guide (no SpCas9 target near
    any variant) | no_edit (nothing to edit).
    """
    cutoff = threshold() if cutoff is None else cutoff
    scored = [(g, e) for g, e in edits if e.get("advisability") and e["advisability"]["score"] is not None]
    if not edits:
        return _overview("no_edit", None, cutoff, None, "No CRISPR edit is proposed.", 0)
    if all(e.get("guides") == [] for _, e in edits):
        return _overview(
            "no_guide",
            None,
            cutoff,
            None,
            "No standard SpCas9 guide could be designed close enough to the variant.",
            len(edits),
        )
    if not scored:
        return _overview("unavailable", None, cutoff, None, "CRISPR efficiency could not be predicted.", len(edits))
    gene, best = max(scored, key=lambda pair: pair[1]["advisability"]["score"])
    score = best["advisability"]["score"]
    target = best.get("variant") or gene  # ClinVar variant names already include the gene
    if score >= cutoff:
        headline = f"CRISPR is advisable: predicted efficiency {score:.0f}/100 meets the {cutoff:.0f} threshold."
        verdict = "recommended"
    else:
        headline = f"CRISPR is not advisable: predicted efficiency {score:.0f}/100 is below the {cutoff:.0f} threshold."
        verdict = "not_recommended"
    return _overview(verdict, score, cutoff, target, headline, len(edits), best["advisability"]["band"], gene)


def _overview(verdict, score, cutoff, target, headline, considered, band=None, gene=None) -> dict:
    return {
        "verdict": verdict,
        "score": score,
        "band": band,
        "threshold": cutoff,
        "gene": gene,
        "target": target,  # the variant whose best guide sets the score
        "headline": headline,
        "edits_considered": considered,
        "basis": BASIS,
    }
