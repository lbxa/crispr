"""CRISPRon input encoding. Pure Python (3.8+), so it is testable without TensorFlow."""

from typing import List

BASES = "ACGT"  # CRISPRon's order: A=0, C=1, G=2, T=3
LENGTH = 30  # 4 nt 5' context + 20 nt protospacer + 3 nt PAM + 3 nt 3' context


def validate(context: str) -> str:
    context = context.upper().replace("U", "T")
    if len(context) != LENGTH or set(context) - set(BASES):
        raise ValueError("expected a %d-nt A/C/G/T sequence, got %r" % (LENGTH, context[:40]))
    if context[25:27] != "GG":
        raise ValueError("expected an NGG PAM at positions 25-27 (1-based), got %r" % context[24:27])
    return context


def one_hot(contexts: List[str]) -> List[List[List[float]]]:
    """[batch, 30, 4] nested lists of 0.0/1.0."""
    return [[[1.0 if base == b else 0.0 for b in BASES] for base in validate(c)] for c in contexts]


def guide_with_pam(context: str) -> str:
    """The 23-nt protospacer + PAM that CRISPRoff's energy model takes."""
    return validate(context)[4:27]
