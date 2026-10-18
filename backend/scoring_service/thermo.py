"""ΔG of binding for CRISPRon, computed the way CRISPRon does.

Upstream CRISPRon does not call ViennaRNA directly for this input. It runs the CRISPRoff
pipeline (`CRISPRspec_CRISPRoff_pipeline.py`, downloaded separately from the CRISPRoff
project) over the 23-nt guide+PAM sequences, with its `data/model/energy_dics.pkl` duplex
energy parameters. That pipeline uses RNAfold (ViennaRNA 2.2.5) internally and writes
`CRISPRparams.tsv`; DeepCRISPRon_eval.py reads the 7th column (index 6) as ΔG. We run the
same script and read the same column, so the value matches upstream exactly.

Environment: CRISPRON_DIR (the cloned RTH-tools/crispron repo) and, if it is not in
$CRISPRON_DIR/bin, CRISPROFF_SCRIPT (path to the CRISPRoff pipeline script).
"""

import os
import subprocess
import sys
import tempfile
from typing import Dict, List

from .encoding import guide_with_pam

# CRISPRparams.tsv columns 3-7 (after guideID, guideSeq); key -> (column index, header name).
COLUMNS = {
    "rna_dna": (2, "RNA_DNA_eng"),
    "rna_dna_weighted": (3, "RNA_DNA_eng_weighted"),
    "dna_opening": (4, "DNA_DNA_opening"),
    "spacer_self_fold": (5, "spacer_self_fold"),
    "crisproff_score": (6, "CRISPRoff_score"),  # the model's input_dGB (upstream reads column index 6)
}


def parse_params(text: str) -> List[Dict[str, float]]:
    """Read the energy terms per guide, in file order, from a CRISPRparams.tsv."""
    lines = [line.split("\t") for line in text.splitlines() if line.strip()]
    header = lines[0]
    for key, (index, name) in COLUMNS.items():
        if len(header) <= index or header[index] != name:
            raise RuntimeError("unexpected CRISPRoff output: column %d should be %s (%s)" % (index, name, key))
    return [{key: float(row[index]) for key, (index, _) in COLUMNS.items()} for row in lines[1:]]


def energies(contexts: List[str]) -> List[Dict[str, float]]:
    root = os.environ["CRISPRON_DIR"]
    script = os.environ.get("CRISPROFF_SCRIPT") or os.path.join(root, "bin", "CRISPRspec_CRISPRoff_pipeline.py")
    with tempfile.TemporaryDirectory() as tmp:
        fasta, report, params = (os.path.join(tmp, name) for name in ("23mers.fa", "spec.tsv", "params.tsv"))
        with open(fasta, "w") as handle:
            for index, context in enumerate(contexts):
                handle.write(">g%d\n%s\n" % (index, guide_with_pam(context)))
        subprocess.run(
            [
                sys.executable, script,
                "--guides", fasta,
                "--specificity_report", report,
                "--guide_params_out", params,
                "--duplex_energy_params", os.path.join(root, "data", "model", "energy_dics.pkl"),
                "--no_azimuth",
            ],
            check=True,
            capture_output=True,
            cwd=tmp,  # RNAfold writes .ps files into its working directory
        )  # fmt: skip
        with open(params) as handle:
            values = parse_params(handle.read())
    if len(values) != len(contexts):
        raise RuntimeError("CRISPRoff returned %d energies for %d guides" % (len(values), len(contexts)))
    return values
