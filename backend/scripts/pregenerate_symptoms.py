"""Have the language model write plain-language symptom descriptions for demo genomes.

Uses the model chosen by CRISPR_LLM (see .env.example). With Gemini this takes a few
seconds per genome. Granite runs at ~1 token/s on the 3-vCPU LinuxONE VM (~1-2 min per
description), so with Granite run it on the server in the background:

    nohup .venv/bin/python -m scripts.pregenerate_symptoms --genomes 40 > pregenerate.log 2>&1 &

Orders and scripts/evaluate.py use these descriptions when present. Safe to stop and
rerun: genomes that already have a description are skipped.
"""

import argparse
import json
import random

from crispr_backend import db
from crispr_backend.llm import get_llm
from crispr_backend.simulation import symptoms


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--genomes", type=int, default=40)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    llm = get_llm()
    if llm is None:
        raise SystemExit("No language model: set GEMINI_API_KEY in backend/.env, or run on the server for Granite.")

    with db.session() as connection:
        pending = connection.execute(
            """SELECT id FROM genomes WHERE id NOT IN (SELECT genome_id FROM genome_symptoms)
               ORDER BY id LIMIT ?""",
            (args.genomes,),
        ).fetchall()
        for number, row in enumerate(pending, start=1):
            terms, scenario = symptoms.choose_terms(connection, row["id"], rng)
            text = symptoms.llm_description(llm, terms)
            connection.execute(
                "INSERT INTO genome_symptoms (genome_id, scenario, terms, text, source) VALUES (?, ?, ?, ?, ?)",
                (row["id"], scenario, json.dumps(terms), text, llm.name),
            )
            connection.commit()
            print(f"[{number}/{len(pending)}] genome {row['id']} ({scenario}): {text}", flush=True)


if __name__ == "__main__":
    main()
