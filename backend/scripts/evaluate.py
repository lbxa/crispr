"""Measure how well the pipeline recovers planted diseases and avoids false alarms.

    .venv/bin/python -m scripts.evaluate [--repeats 3]

For every demo genome, a simulated customer describes symptoms (pre-generated Granite
text if present, else the template), the pipeline analyzes it, and the result is
compared with genome_truth. Template text reuses HPO term names, so it is an easier
test than real patient language; report which source was used.
"""

import argparse
import random
from collections import Counter

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.simulation import symptoms
from crispr_backend.vcf import read_calls_gz

FALSE_ALARM = {"likely_genetic_cause", "genetic_finding"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repeats", type=int, default=3, help="symptom descriptions per genome")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    with db.session() as connection:
        analyzer = Analyzer(connection)
        genomes = connection.execute("SELECT id, sex, vcf_gz FROM genomes").fetchall()
        diseased, controls, sources = Counter(), Counter(), Counter()
        misses = []
        for genome in genomes:
            planted = symptoms.truth(connection, genome["id"])
            calls = read_calls_gz(genome["vcf_gz"])
            for _ in range(args.repeats):
                text, source = symptoms.describe(connection, genome["id"], rng)
                sources[source] += 1
                report = analyzer.analyze(calls, text, genome["sex"])
                findings = report["findings"]
                if planted["omim_id"]:
                    diseased["cases"] += 1
                    top = findings[0] if findings else None
                    if top and top["omim_id"] == planted["omim_id"] and top["tier"] == "likely":
                        diseased["top_likely"] += 1
                    elif any(f["omim_id"] == planted["omim_id"] for f in findings):
                        diseased["found_not_top_likely"] += 1
                        misses.append((planted["disease"], top["tier"] if top else None, text))
                    else:
                        diseased["missed"] += 1
                        misses.append((planted["disease"], None, text))
                else:
                    controls["cases"] += 1
                    controls[report["conclusion"]["status"]] += 1

    print(f"Symptom text sources: {dict(sources)}\n")
    n = diseased["cases"]
    print(f"Planted disease cases: {n}")
    print(f"  ranked first as 'likely':   {diseased['top_likely']:>4}  ({diseased['top_likely'] / n:.0%})")
    print(f"  found, not first/'likely':  {diseased['found_not_top_likely']:>4}")
    print(f"  genotype missed:            {diseased['missed']:>4}")
    m = controls["cases"]
    alarms = sum(controls[s] for s in FALSE_ALARM)
    print(f"\nControl cases: {m}")
    for status in ("no_finding", "carrier_only", "genetic_finding", "likely_genetic_cause"):
        print(f"  {status:<22} {controls[status]:>4}")
    print(f"  false alarm rate: {alarms / m:.0%}" if m else "")
    if misses:
        print("\nExamples not ranked first as 'likely':")
        for disease, tier, text in misses[:5]:
            print(f"  [{disease}; top tier {tier}] {text}")


if __name__ == "__main__":
    main()
