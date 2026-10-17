"""SpCas9 guide and repair-template design for a pathogenic variant.

Research prototype: guides are ranked with simple, explainable rules (distance from
cut site to variant, GC content, poly-T, allele specificity). Off-target activity
is not assessed and would need a genome-wide search (e.g. CRISPOR) before any use.
"""

from dataclasses import dataclass

from crispr_backend.panel import Inheritance, Mechanism

PROTOSPACER = 20
SEED = 10  # PAM-proximal bases where mismatches block cutting
WINDOW = 60  # bases searched on each side of the variant
MAX_CUT_DISTANCE = 20
DONOR_ARM = 60  # homology on each side of the corrected site in the repair template
COMPLEMENT = str.maketrans("ACGTN", "TGCAN")


def reverse_complement(sequence: str) -> str:
    return sequence.translate(COMPLEMENT)[::-1]


@dataclass(frozen=True)
class Guide:
    spacer: str  # 5'->3', 20 nt, matches the patient's (mutant) DNA
    pam: str
    strand: str  # '+' or '-' relative to the reference genome
    cut_position: int  # genomic coordinate of the base 5' of the cut (forward strand)
    cut_distance: int  # bases between cut site and nearest variant base
    gc_content: float
    allele_specific: bool  # variant lies in the seed or PAM, so the healthy allele is not cut
    score: float
    notes: tuple[str, ...]


@dataclass(frozen=True)
class EditPlan:
    strategy: str
    rationale: str
    guides: list[Guide]
    repair_template: str | None
    repair_template_notes: str | None
    alternative: str | None
    off_target: str = "Not assessed. Run a genome-wide off-target search before any lab use."


def _score(gc: float, distance: int, allele_specific: bool, spacer: str) -> tuple[float, list[str]]:
    score, notes = 100.0, []
    score -= distance * 3
    if not 0.4 <= gc <= 0.6:
        score -= 15
        notes.append(f"GC content {gc:.0%} is outside 40-60%")
    if spacer.startswith("G"):
        score += 2  # convenient for U6-promoter transcription
    if allele_specific:
        score += 10
        notes.append("Variant is in the seed/PAM: cuts the mutant allele only")
    return round(score, 1), notes


def find_guides(region_sequence: str, region_start: int, pos: int, ref: str, alt: str) -> list[Guide]:
    """Enumerate SpCas9 (NGG) guides on the patient's mutant sequence around a variant."""
    offset = pos - region_start  # 0-based index of the variant's first base in the region
    if region_sequence[offset : offset + len(ref)] != ref:
        raise ValueError(f"Reference mismatch at {pos}: expected {ref}")
    left = region_sequence[max(0, offset - WINDOW) : offset]
    right = region_sequence[offset + len(ref) : offset + len(ref) + WINDOW]
    mutant = left + alt + right
    window_start = region_start + offset - len(left)  # genomic coordinate of mutant[0]
    variant_span = (len(left), len(left) + max(len(alt), 1))  # [start, end) of the variant in `mutant`

    def distance_to_variant(cut: int) -> int:
        """Bases between a cut (between cut-1 and cut) and the variant span."""
        start, end = variant_span
        return 0 if start <= cut <= end else min(abs(cut - start), abs(cut - end))

    guides = []
    for i in range(len(mutant) - PROTOSPACER - 2):
        # Forward strand: protospacer mutant[i:i+20], PAM mutant[i+20:i+23] = NGG, cut 3 nt 5' of PAM.
        if mutant[i + PROTOSPACER + 1 : i + PROTOSPACER + 3] == "GG":
            spacer, pam, cut = mutant[i : i + PROTOSPACER], mutant[i + PROTOSPACER : i + PROTOSPACER + 3], i + 17
            seed = (i + PROTOSPACER - SEED, i + PROTOSPACER + 3)
            guides.append(("+", spacer, pam, cut, seed))
        # Reverse strand: CCN at mutant[i:i+3], protospacer is the reverse complement of mutant[i+3:i+23].
        if mutant[i : i + 2] == "CC":
            spacer = reverse_complement(mutant[i + 3 : i + 3 + PROTOSPACER])
            pam, cut = reverse_complement(mutant[i : i + 3]), i + 6
            seed = (i, i + 3 + SEED)
            guides.append(("-", spacer, pam, cut, seed))

    designed = []
    for strand, spacer, pam, cut, (seed_start, seed_end) in guides:
        distance = distance_to_variant(cut)
        if distance > MAX_CUT_DISTANCE or "TTTT" in spacer or "N" in spacer:
            continue
        gc = (spacer.count("G") + spacer.count("C")) / PROTOSPACER
        allele_specific = variant_span[0] < seed_end and variant_span[1] > seed_start
        score, notes = _score(gc, distance, allele_specific, spacer)
        designed.append(
            Guide(
                spacer,
                pam,
                strand,
                window_start + cut - 1,
                distance,
                round(gc, 2),
                allele_specific,
                score,
                tuple(notes),
            )
        )
    return sorted(designed, key=lambda guide: guide.score, reverse=True)


def repair_template(region_sequence: str, region_start: int, pos: int, ref: str) -> str:
    """Single-stranded donor carrying the healthy (reference) allele with homology arms."""
    offset = pos - region_start
    return region_sequence[max(0, offset - DONOR_ARM) : offset + len(ref) + DONOR_ARM]


def base_editing_option(ref: str, alt: str) -> str | None:
    """Can a base editor revert alt -> ref without a double-strand break?"""
    if len(ref) != 1 or len(alt) != 1:
        return "Prime editing could install the correction without a double-strand break (indel variant)."
    change = (alt, ref)
    if change in {("A", "G"), ("T", "C")}:
        return f"Adenine base editor (ABE) could revert {alt}>{ref} without a double-strand break."
    if change in {("C", "T"), ("G", "A")}:
        return f"Cytosine base editor (CBE) could revert {alt}>{ref} without a double-strand break."
    return f"Transversion {alt}>{ref}: prime editing is the precise no-break option."


def plan_edit(
    region_sequence: str,
    region_start: int,
    pos: int,
    ref: str,
    alt: str,
    inheritance: Inheritance,
    mechanism: Mechanism,
    max_guides: int = 3,
) -> EditPlan:
    guides = find_guides(region_sequence, region_start, pos, ref, alt)
    alternative = base_editing_option(ref, alt)
    dominant = inheritance in (Inheritance.AUTOSOMAL_DOMINANT, Inheritance.X_LINKED_DOMINANT)
    specific = [guide for guide in guides if guide.allele_specific]

    if dominant and mechanism in (Mechanism.GAIN_OF_FUNCTION, Mechanism.DOMINANT_NEGATIVE) and specific:
        return EditPlan(
            strategy="Allele-specific knockout",
            rationale=(
                "The mutant protein is actively harmful, so disrupting only the mutant copy (non-homologous "
                "end joining) can help while the healthy copy keeps working."
            ),
            guides=specific[:max_guides],
            repair_template=None,
            repair_template_notes=None,
            alternative=alternative,
        )

    template = repair_template(region_sequence, region_start, pos, ref)
    blocks_recut = bool(guides) and guides[0].allele_specific
    return EditPlan(
        strategy="Homology-directed repair (correction)",
        rationale=(
            "The disease comes from losing working protein, so the variant should be corrected back to the "
            "healthy sequence rather than knocked out."
            if not dominant
            else "Correct the mutant copy back to the healthy sequence; knocking it out would not restore function."
        ),
        guides=guides[:max_guides],
        repair_template=template,
        repair_template_notes=(
            "Correcting the variant also destroys the top guide's target, preventing re-cutting."
            if blocks_recut
            else "Add a silent mutation in the PAM or seed of the chosen guide (check the codon) to prevent re-cutting."
        ),
        alternative=alternative,
    )
