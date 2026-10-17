"""Have Granite write plain-language symptom descriptions for demo genomes, ahead of time.

Granite runs at ~1 token/s on a 3-vCPU LinuxONE VM (~1-2 min per description), so this
is a batch job, not part of an order. Run on the server, in the background:

    nohup .venv/bin/python -m scripts.pregenerate_symptoms --genomes 40 > pregenerate.log 2>&1 &

Orders and scripts/evaluate.py use these descriptions when present. Safe to stop and
rerun: genomes that already have a description are skipped.
"""

import argparse
import json
import random

from crispr_backend import db
from crispr_backend.granite import get_granite
from crispr_backend.simulation import symptoms


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--genomes", type=int, default=40)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    granite = get_granite()
    if granite is None:
        raise SystemExit("Granite unavailable: install llama-cpp-python and set GRANITE_GGUF to an instruct model.")

    with db.session() as connection:
        pending = connection.execute(
            """SELECT id FROM genomes WHERE id NOT IN (SELECT genome_id FROM genome_symptoms)
               ORDER BY id LIMIT ?""",
            (args.genomes,),
        ).fetchall()
        for number, row in enumerate(pending, start=1):
            terms, scenario = symptoms.choose_terms(connection, row["id"], rng)
            text = symptoms.granite_description(granite, terms)
            connection.execute(
                "INSERT INTO genome_symptoms (genome_id, scenario, terms, text, source) VALUES (?, ?, ?, ?, 'granite')",
                (row["id"], scenario, json.dumps(terms), text),
            )
            connection.commit()
            print(f"[{number}/{len(pending)}] genome {row['id']} ({scenario}): {text}", flush=True)


if __name__ == "__main__":
    main()
