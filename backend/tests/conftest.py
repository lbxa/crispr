"""A tiny self-contained database: two diseases on a synthetic gene region, two genomes."""

import gzip
import json
import random

import pytest

from crispr_backend import db
from crispr_backend.llm import get_llm

REGION_START = 1_000
RNG = random.Random(42)
SEQUENCE = "".join(RNG.choice("ACGT") for _ in range(400))
# Plant a PAM (AGG) right after position 1200 so guide design has a known target.
SEQUENCE = SEQUENCE[:205] + "AGG" + SEQUENCE[208:]


def base(pos: int) -> str:
    return SEQUENCE[pos - REGION_START]


def alt_for(pos: int) -> str:
    return next(b for b in "ACGT" if b != base(pos))


AR_VARIANTS = [(1, 1100), (2, 1150), (3, 1200)]  # recessive "Familial Mediterranean fever" (gene MEFV)
AD_VARIANT = (4, 1300)  # dominant "Achondroplasia" (gene FGFR3)

DISEASES = [
    ("OMIM:249100", "Familial Mediterranean fever", "MEFV", "AR", "loss_of_function"),
    ("OMIM:100800", "Achondroplasia", "FGFR3", "AD", "gain_of_function"),
]
PHENOTYPES = [
    ("OMIM:249100", "HP:0001954", "Recurrent fever", 0.9),
    ("OMIM:249100", "HP:0002027", "Abdominal pain", 0.9),
    ("OMIM:249100", "HP:0002829", "Arthralgia", 0.55),
    ("OMIM:100800", "HP:0000256", "Macrocephaly", 0.9),
    ("OMIM:100800", "HP:0004322", "Short stature", 1.0),
    ("OMIM:100800", "HP:0002650", "Scoliosis", 0.17),
]


def vcf(sample: str, records: list[tuple[int, str]]) -> str:
    lines = ["##fileformat=VCFv4.2", f"#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t{sample}"]
    lines += [f"chr16\t{pos}\t.\t{base(pos)}\t{alt_for(pos)}\t.\tPASS\t.\tGT\t{gt}" for pos, gt in records]
    return "\n".join(lines) + "\n"


@pytest.fixture(autouse=True)
def no_language_model(monkeypatch):
    """Tests never call Gemini or Granite, even if a developer's backend/.env enables one."""
    monkeypatch.setenv("CRISPR_LLM", "none")
    get_llm.cache_clear()
    yield
    get_llm.cache_clear()


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / "test.sqlite"
    monkeypatch.setenv("CRISPR_DB", str(path))
    populate(path)
    return path


def populate(path):
    """Fill a database with the synthetic diseases and genomes (also used by scripts/dev_stack.py)."""
    with db.session(path) as connection:
        connection.executemany("INSERT INTO diseases VALUES (?, ?, ?, ?, ?)", DISEASES)
        connection.executemany("INSERT INTO disease_phenotypes VALUES (?, ?, ?, ?)", PHENOTYPES)
        for gene in ("MEFV", "FGFR3"):
            connection.execute(
                "INSERT INTO gene_regions VALUES (?, '16', ?, ?, 1, ?)",
                (gene, REGION_START, REGION_START + len(SEQUENCE) - 1, SEQUENCE),
            )
        for variation_id, pos in AR_VARIANTS:
            connection.execute(
                "INSERT INTO variants VALUES (?, 'OMIM:249100', 'MEFV', '16', ?, ?, ?, 'Pathogenic', 2, 'single_nucleotide_variant', ?, NULL)",
                (variation_id, pos, base(pos), alt_for(pos), f"MEFV variant {variation_id}"),
            )
        variation_id, pos = AD_VARIANT
        connection.execute(
            "INSERT INTO variants VALUES (?, 'OMIM:100800', 'FGFR3', '16', ?, ?, ?, 'Pathogenic', 3, 'single_nucleotide_variant', 'FGFR3 G380R', NULL)",
            (variation_id, pos, base(pos), alt_for(pos)),
        )
        # Genome 1: FMF, compound heterozygous. Genome 2: control carrying one FMF variant.
        connection.execute(
            "INSERT INTO genomes VALUES (1, 'HG00001', 'female', ?)",
            (gzip.compress(vcf("HG00001", [(1100, "1|0"), (1200, "0|1")]).encode()),),
        )
        connection.execute(
            "INSERT INTO genomes VALUES (2, 'HG00002', 'male', ?)",
            (gzip.compress(vcf("HG00002", [(1150, "0|1")]).encode()),),
        )
        connection.execute("INSERT INTO genome_truth VALUES (1, 'OMIM:249100', ?)", (json.dumps([1, 3]),))
        connection.execute("INSERT INTO genome_truth VALUES (2, NULL, '[]')")
