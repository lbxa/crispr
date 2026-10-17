"""Build demo genomes: real 1000 Genomes samples, some with a planted disease.

Each genome is a single-sample VCF restricted to the panel gene regions (GRCh38),
taken from the 1000 Genomes 30x phased panel by remote tabix queries. A fraction of
genomes get ClinVar pathogenic variants planted in a pattern that causes disease
(one copy for dominant, two for recessive, hemizygous for X-linked in males). The
rest are controls. What was planted goes to genome_truth, which the analysis never reads.

Run after build_reference:

    .venv/bin/python -m etl.build_genomes --samples 200 --disease-fraction 0.5
"""

import argparse
import gzip
import json
import random
import urllib.request
from collections import defaultdict

import pysam

from crispr_backend import db
from crispr_backend.panel import Inheritance

KGP = "http://ftp.1000genomes.ebi.ac.uk/vol1/ftp/data_collections/1000G_2504_high_coverage"
PANEL_DIR = f"{KGP}/working/20220422_3202_phased_SNV_INDEL_SV"
PED = f"{KGP}/20130606_g1k_3202_samples_ped_population.txt"
RAW_DIR = db.BACKEND_ROOT / "data" / "raw" / "1kgp"
MAX_ALLELE = 50  # skip structural variants and long symbolic alleles


def chrom_file(chrom: str) -> str:
    suffix = ".v2" if chrom == "X" else ""
    return f"1kGP_high_coverage_Illumina.chr{chrom}.filtered.SNV_INDEL_SV_phased_panel{suffix}.vcf.gz"


def tabix(chrom: str) -> pysam.TabixFile:
    name = chrom_file(chrom)
    index = RAW_DIR / f"{name}.tbi"
    if not index.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f"{PANEL_DIR}/{name}.tbi", index)
    return pysam.TabixFile(f"{PANEL_DIR}/{name}", index=str(index))


def choose_samples(count: int, rng: random.Random) -> list[tuple[str, str]]:
    """Unrelated founders (no parents listed), balanced by sex: [(sample_id, sex)]."""
    with urllib.request.urlopen(PED) as response:
        rows = [line.split() for line in response.read().decode().splitlines()[1:]]
    founders = [(row[1], "male" if row[4] == "1" else "female") for row in rows if row[2] == "0" and row[3] == "0"]
    males = [s for s in founders if s[1] == "male"]
    females = [s for s in founders if s[1] == "female"]
    return rng.sample(males, count // 2) + rng.sample(females, count - count // 2)


def extract(regions: list, samples: list[str]) -> dict[str, list[tuple]]:
    """sample -> [(chrom, pos, ref, alt, genotype)] for non-reference calls in the panel regions."""
    calls: dict[str, list[tuple]] = defaultdict(list)
    by_chrom = defaultdict(list)
    for region in regions:
        by_chrom[region["chrom"]].append(region)
    for chrom, chrom_regions in sorted(by_chrom.items()):
        with tabix(chrom) as vcf:
            columns = list(vcf.header)[-1].split("\t")
            positions = {sample: columns.index(sample) for sample in samples}
            for region in chrom_regions:
                count = 0
                for line in vcf.fetch(f"chr{chrom}", region["start"] - 1, region["end"]):
                    fields = line.split("\t")
                    ref, alt = fields[3], fields[4]
                    if "," in alt or "<" in alt or max(len(ref), len(alt)) > MAX_ALLELE:
                        continue
                    for sample, column in positions.items():
                        genotype = fields[column].split(":")[0]
                        if "1" in genotype:
                            calls[sample].append((chrom, int(fields[1]), ref, alt, genotype))
                    count += 1
                print(f"  {region['gene']:<9} {count} sites")
    return calls


def plant(connection, rng: random.Random, sex: str) -> tuple[str, list[dict], list[str]]:
    """Pick a disease compatible with the sample's sex and the variant genotypes that cause it."""
    eligible = []
    for disease in connection.execute("SELECT * FROM diseases"):
        inheritance = Inheritance(disease["inheritance"])
        if inheritance is Inheritance.X_LINKED_RECESSIVE and sex != "male":
            continue  # affected females need two X hits; rare, so not simulated
        if inheritance is Inheritance.X_LINKED_DOMINANT and sex != "female":
            continue  # Rett syndrome: males are rarely viable
        variants = (
            connection.execute(
                "SELECT * FROM variants WHERE omim_id = ? AND stars >= 2", (disease["omim_id"],)
            ).fetchall()
            or connection.execute("SELECT * FROM variants WHERE omim_id = ?", (disease["omim_id"],)).fetchall()
        )
        if variants:
            eligible.append((disease, variants))

    disease, variants = rng.choice(eligible)
    inheritance = Inheritance(disease["inheritance"])
    on_x = variants[0]["chrom"] == "X"
    if inheritance in (Inheritance.AUTOSOMAL_DOMINANT, Inheritance.X_LINKED_DOMINANT):
        chosen, genotypes = [rng.choice(variants)], [rng.choice(["0|1", "1|0"])]
    elif on_x and sex == "male":
        chosen, genotypes = [rng.choice(variants)], ["1"]
    elif len(variants) > 1 and rng.random() < 0.5:
        chosen, genotypes = rng.sample(variants, 2), ["1|0", "0|1"]  # compound heterozygous
    else:
        chosen, genotypes = [rng.choice(variants)], ["1|1"]
    return disease["omim_id"], [dict(v) for v in chosen], genotypes


def render_vcf(sample: str, calls: list[tuple]) -> bytes:
    header = [
        "##fileformat=VCFv4.2",
        "##reference=GRCh38",
        "##source=crispr-demo: 1000 Genomes 30x phased panel, panel genes only",
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t" + sample,
    ]
    chrom_order = {str(n): n for n in range(1, 23)} | {"X": 23}
    rows = [
        f"chr{chrom}\t{pos}\t.\t{ref}\t{alt}\t.\tPASS\t.\tGT\t{genotype}"
        for chrom, pos, ref, alt, genotype in sorted(calls, key=lambda c: (chrom_order[c[0]], c[1]))
    ]
    return gzip.compress(("\n".join(header + rows) + "\n").encode())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", type=int, default=200)
    parser.add_argument("--disease-fraction", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    with db.session() as connection:
        regions = [dict(row) for row in connection.execute("SELECT gene, chrom, start, end FROM gene_regions")]
        if not regions:
            raise SystemExit("Run etl.build_reference first.")
        samples = choose_samples(args.samples, rng)
        print(f"Extracting {len(regions)} gene regions for {len(samples)} samples")
        calls = extract(regions, [sample for sample, _sex in samples])

        connection.execute("DELETE FROM orders")
        connection.execute("DELETE FROM genome_truth")
        connection.execute("DELETE FROM genomes")
        diseased = set(rng.sample(range(len(samples)), round(len(samples) * args.disease_fraction)))
        for number, (sample, sex) in enumerate(samples):
            sample_calls = calls[sample]
            omim_id, planted, genotypes = None, [], []
            if number in diseased:
                omim_id, planted, genotypes = plant(connection, rng, sex)
                planted_loci = {(v["chrom"], v["pos"]) for v in planted}
                sample_calls = [c for c in sample_calls if (c[0], c[1]) not in planted_loci]
                sample_calls += [
                    (v["chrom"], v["pos"], v["ref"], v["alt"], gt) for v, gt in zip(planted, genotypes, strict=True)
                ]
            genome_id = connection.execute(
                "INSERT INTO genomes (sample_id, sex, vcf_gz) VALUES (?, ?, ?)",
                (sample, sex, render_vcf(sample, sample_calls)),
            ).lastrowid
            connection.execute(
                "INSERT INTO genome_truth VALUES (?, ?, ?)",
                (genome_id, omim_id, json.dumps([v["variation_id"] for v in planted])),
            )

        print(f"Stored {len(samples)} genomes ({len(diseased)} with a planted disease)")
        for row in connection.execute(
            """SELECT COALESCE(d.name, '(control)') AS disease, COUNT(*) AS genomes
               FROM genome_truth t LEFT JOIN diseases d USING (omim_id) GROUP BY 1 ORDER BY 2 DESC"""
        ):
            print(f"  {row['disease']:<50} {row['genomes']}")


if __name__ == "__main__":
    main()
