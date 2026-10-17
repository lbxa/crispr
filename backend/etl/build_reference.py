"""Build the reference tables: diseases, their symptoms, ClinVar variants, gene sequences.

Run on a laptop (needs pysam, which is not required on LinuxONE):

    .venv/bin/python -m etl.build_reference

Sources: HPO phenotype.hpoa (disease -> symptoms), ClinVar GRCh38 VCF read by
remote tabix queries (only panel genes are downloaded), Ensembl REST (gene
coordinates and sequence), NCBI E-utilities (human-readable variant names).
"""

import argparse
import csv
import re
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

import pysam
import requests
from pyhpo import Ontology

from crispr_backend import db
from crispr_backend.panel import PANEL, PANEL_GENES

RAW_DIR = db.BACKEND_ROOT / "data" / "raw"
HPOA_URL = "https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download/phenotype.hpoa"
CLINVAR_VCF = "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/clinvar.vcf.gz"
ENSEMBL = "https://rest.ensembl.org"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
GENE_PADDING = 2_000  # include promoter / UTR-adjacent variants

PATHOGENIC = {"Pathogenic", "Likely_pathogenic", "Pathogenic/Likely_pathogenic"}
REVIEW_STARS = {
    "practice_guideline": 4,
    "reviewed_by_expert_panel": 3,
    "criteria_provided,_multiple_submitters,_no_conflicts": 2,
    "criteria_provided,_single_submitter": 1,
    "criteria_provided,_conflicting_classifications": 1,
}
# HPO frequency terms -> representative probability.
HPO_FREQUENCY = {
    "HP:0040280": 1.0,  # obligate
    "HP:0040281": 0.9,  # very frequent (80-99%)
    "HP:0040282": 0.55,  # frequent (30-79%)
    "HP:0040283": 0.17,  # occasional (5-29%)
    "HP:0040284": 0.02,  # very rare (1-4%)
    "HP:0040285": 0.0,  # excluded
}
DNA = re.compile(r"^[ACGT]+$")


def parse_frequency(value: str) -> float | None:
    if not value:
        return None
    if value in HPO_FREQUENCY:
        return HPO_FREQUENCY[value]
    if value.endswith("%"):
        return float(value[:-1]) / 100
    if "/" in value:
        numerator, denominator = value.split("/")
        return int(numerator) / int(denominator) if int(denominator) else None
    return None


def download(url: str, path: Path) -> Path:
    if not path.exists():
        print(f"Downloading {url}")
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def load_phenotypes(hpoa: Path) -> dict[str, dict[str, float | None]]:
    """omim_id -> {hpo_id: frequency} for panel diseases."""
    wanted = {disease.omim_id for disease in PANEL}
    phenotypes: dict[str, dict[str, float | None]] = defaultdict(dict)
    with hpoa.open() as handle:
        rows = (line for line in handle if not line.startswith("#"))
        for row in csv.DictReader(rows, delimiter="\t"):
            if row["database_id"] not in wanted or row["aspect"] != "P" or row["qualifier"] == "NOT":
                continue
            frequency = parse_frequency(row["frequency"])
            if frequency == 0.0:
                continue
            # A term can be annotated several times (one row per reference); keep the highest frequency.
            terms = phenotypes[row["database_id"]]
            known = [f for f in (terms.get(row["hpo_id"]), frequency) if f is not None]
            terms[row["hpo_id"]] = max(known) if known else None
    return phenotypes


def ensembl(path: str, **params) -> requests.Response:
    for attempt in range(5):
        try:
            response = requests.get(
                f"{ENSEMBL}{path}", params=params, headers={"Content-Type": "application/json"}, timeout=60
            )
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 4:
                raise
            time.sleep(2 + 2 * attempt)
            continue
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(float(response.headers.get("Retry-After", 2 + 2 * attempt)))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError(f"Ensembl {path}: still failing after 5 attempts")


def gene_region(gene: str) -> dict:
    info = ensembl(f"/lookup/symbol/homo_sapiens/{gene}").json()
    if info.get("assembly_name") != "GRCh38":
        raise RuntimeError(f"{gene}: unexpected assembly {info.get('assembly_name')}")
    chrom = info["seq_region_name"]
    start, end = info["start"] - GENE_PADDING, info["end"] + GENE_PADDING
    sequence = ensembl(f"/sequence/region/human/{chrom}:{start}..{end}:1").json()["seq"].upper()
    if len(sequence) != end - start + 1:
        raise RuntimeError(f"{gene}: sequence length mismatch")
    return {"gene": gene, "chrom": chrom, "start": start, "end": end, "strand": info["strand"], "sequence": sequence}


def clinvar_variants(region: dict, diseases: list) -> list[dict]:
    """Pathogenic ClinVar variants in the region linked to one of the gene's panel diseases."""
    by_omim = {disease.omim_id: disease for disease in diseases}
    variants = []
    index = download(f"{CLINVAR_VCF}.tbi", RAW_DIR / "clinvar.vcf.gz.tbi")
    with pysam.TabixFile(CLINVAR_VCF, index=str(index), encoding="utf-8") as clinvar:
        for line in clinvar.fetch(region["chrom"], region["start"] - 1, region["end"]):
            chrom, pos, variation_id, ref, alt, _qual, _filter, info = line.split("\t")[:8]
            fields = dict(item.split("=", 1) for item in info.split(";") if "=" in item)
            if fields.get("CLNSIG") not in PATHOGENIC:
                continue
            if not (DNA.match(ref) and DNA.match(alt)) or max(len(ref), len(alt)) > 50:
                continue
            genes = {entry.split(":")[0] for entry in fields.get("GENEINFO", "").split("|")}
            if region["gene"] not in genes:
                continue
            linked = [omim for omim in by_omim if omim in fields.get("CLNDISDB", "")]
            if not linked:
                continue
            variants.append(
                {
                    "variation_id": int(variation_id),
                    "omim_id": linked[0],
                    "gene": region["gene"],
                    "chrom": chrom,
                    "pos": int(pos),
                    "ref": ref,
                    "alt": alt,
                    "significance": fields["CLNSIG"],
                    "stars": REVIEW_STARS.get(fields.get("CLNREVSTAT", ""), 0),
                    "variant_type": fields.get("CLNVC", ""),
                    "rsid": f"rs{fields['RS']}" if "RS" in fields else None,
                }
            )
    return variants


def variant_names(variation_ids: list[int]) -> dict[int, str]:
    names: dict[int, str] = {}
    for start in range(0, len(variation_ids), 200):
        batch = variation_ids[start : start + 200]
        response = requests.post(
            f"{EUTILS}/esummary.fcgi",
            data={"db": "clinvar", "id": ",".join(map(str, batch)), "retmode": "json"},
            timeout=120,
        )
        response.raise_for_status()
        result = response.json()["result"]
        for uid in result.get("uids", []):
            names[int(uid)] = result[uid].get("title", "")
        time.sleep(0.4)  # NCBI allows 3 requests/second without an API key
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=db.db_path())
    parser.add_argument("--refresh", action="store_true", help="re-download genes already built")
    args = parser.parse_args()

    phenotypes = load_phenotypes(download(HPOA_URL, RAW_DIR / "phenotype.hpoa"))
    Ontology()

    with db.session(args.db) as connection:
        connection.execute("DELETE FROM disease_phenotypes")
        if args.refresh:
            connection.execute("DELETE FROM variants")
            connection.execute("DELETE FROM gene_regions")

        for disease in PANEL:
            # Upsert rather than replace: genome_truth rows may reference the disease.
            connection.execute(
                """INSERT INTO diseases VALUES (?, ?, ?, ?, ?) ON CONFLICT (omim_id) DO UPDATE SET
                   name = excluded.name, gene = excluded.gene,
                   inheritance = excluded.inheritance, mechanism = excluded.mechanism""",
                (disease.omim_id, disease.name, disease.gene, disease.inheritance.value, disease.mechanism.value),
            )
            for hpo_id, frequency in phenotypes[disease.omim_id].items():
                try:
                    term = Ontology.get_hpo_object(hpo_id)
                except RuntimeError:
                    continue  # term retired since pyhpo's bundled ontology
                connection.execute(
                    "INSERT INTO disease_phenotypes VALUES (?, ?, ?, ?)",
                    (disease.omim_id, term.id, term.name, frequency),
                )

        connection.commit()
        done = {row["gene"] for row in connection.execute("SELECT gene FROM gene_regions")}
        for gene in PANEL_GENES:
            if gene in done:
                continue  # resumable: genes are committed one at a time
            region = gene_region(gene)
            connection.execute("DELETE FROM variants WHERE gene = ?", (gene,))
            connection.execute(
                "INSERT INTO gene_regions VALUES (:gene, :chrom, :start, :end, :strand, :sequence)", region
            )
            variants = clinvar_variants(region, [d for d in PANEL if d.gene == gene])
            names = variant_names([v["variation_id"] for v in variants])
            for variant in variants:
                variant["name"] = names.get(variant["variation_id"])
                connection.execute(
                    """INSERT OR REPLACE INTO variants VALUES (:variation_id, :omim_id, :gene, :chrom, :pos,
                    :ref, :alt, :significance, :stars, :variant_type, :name, :rsid)""",
                    variant,
                )
            print(
                f"{gene:<9} chr{region['chrom']}:{region['start']}-{region['end']}  {len(variants)} pathogenic variants"
            )
            connection.commit()

        summary = connection.execute(
            """SELECT d.name, COUNT(DISTINCT p.hpo_id) AS terms,
                      (SELECT COUNT(*) FROM variants v WHERE v.omim_id = d.omim_id) AS variants,
                      (SELECT COUNT(*) FROM variants v WHERE v.omim_id = d.omim_id AND v.stars >= 2) AS reviewed
               FROM diseases d LEFT JOIN disease_phenotypes p USING (omim_id) GROUP BY d.omim_id ORDER BY d.name"""
        ).fetchall()
    print(f"\n{'Disease':<50} {'HPO':>4} {'Variants':>8} {'2+ stars':>8}")
    for row in summary:
        print(f"{row['name']:<50} {row['terms']:>4} {row['variants']:>8} {row['reviewed']:>8}")


if __name__ == "__main__":
    main()
