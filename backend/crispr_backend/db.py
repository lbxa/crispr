"""SQLite storage. One file holds reference data, demo genomes, and orders.

The file is built on a laptop by the ETL scripts and copied to LinuxONE as-is;
SQLite's on-disk format is the same on little- and big-endian machines.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "crispr.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS diseases (
    omim_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    gene        TEXT NOT NULL,
    inheritance TEXT NOT NULL,
    mechanism   TEXT NOT NULL
);

-- Symptoms (HPO terms) annotated to each disease, with how often they occur.
CREATE TABLE IF NOT EXISTS disease_phenotypes (
    omim_id   TEXT NOT NULL REFERENCES diseases(omim_id),
    hpo_id    TEXT NOT NULL,
    hpo_name  TEXT NOT NULL,
    frequency REAL,  -- 0..1, NULL when HPO gives no frequency
    PRIMARY KEY (omim_id, hpo_id)
);

-- ClinVar pathogenic / likely pathogenic variants for panel diseases (GRCh38).
CREATE TABLE IF NOT EXISTS variants (
    variation_id INTEGER PRIMARY KEY,
    omim_id      TEXT NOT NULL REFERENCES diseases(omim_id),
    gene         TEXT NOT NULL,
    chrom        TEXT NOT NULL,  -- no "chr" prefix
    pos          INTEGER NOT NULL,
    ref          TEXT NOT NULL,
    alt          TEXT NOT NULL,
    significance TEXT NOT NULL,
    stars        INTEGER NOT NULL,
    variant_type TEXT NOT NULL,
    name         TEXT,           -- e.g. NM_000492.4(CFTR):c.1521_1523del (p.Phe508del)
    rsid         TEXT
);
CREATE INDEX IF NOT EXISTS variants_locus ON variants (chrom, pos, ref, alt);

-- Reference (GRCh38, forward strand) sequence for each panel gene, for guide design.
CREATE TABLE IF NOT EXISTS gene_regions (
    gene     TEXT PRIMARY KEY,
    chrom    TEXT NOT NULL,
    start    INTEGER NOT NULL,  -- 1-based, inclusive
    end      INTEGER NOT NULL,
    strand   INTEGER NOT NULL,
    sequence TEXT NOT NULL
);

-- Demo genomes: 1000 Genomes samples restricted to panel genes.
CREATE TABLE IF NOT EXISTS genomes (
    id        INTEGER PRIMARY KEY,
    sample_id TEXT NOT NULL,  -- 1000 Genomes sample the background comes from
    sex       TEXT NOT NULL,  -- 'male' | 'female'
    vcf_gz    BLOB NOT NULL
);

-- What the simulation planted. Only the simulation layer reads this table;
-- the analysis pipeline must never see it.
CREATE TABLE IF NOT EXISTS genome_truth (
    genome_id   INTEGER PRIMARY KEY REFERENCES genomes(id),
    omim_id     TEXT REFERENCES diseases(omim_id),  -- NULL for healthy controls
    variant_ids TEXT NOT NULL                       -- JSON list of planted variation_ids
);

-- Customer symptom descriptions written ahead of time by the language model.
CREATE TABLE IF NOT EXISTS genome_symptoms (
    id        INTEGER PRIMARY KEY,
    genome_id INTEGER NOT NULL REFERENCES genomes(id),
    scenario  TEXT NOT NULL,  -- 'disease' | 'phenocopy' | 'everyday'
    terms     TEXT NOT NULL,  -- JSON list of the HPO term names described
    text      TEXT NOT NULL,
    source    TEXT NOT NULL   -- the model: 'gemini' | 'granite'
);

CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL,  -- 'processing' | 'ready' | 'failed'
    genome_id       INTEGER REFERENCES genomes(id),
    sex             TEXT,
    symptoms        TEXT,
    symptoms_source TEXT,           -- 'gemini' | 'granite' | 'template' | 'customer'
    report_json     TEXT,
    error           TEXT
);
"""


def db_path() -> Path:
    return Path(os.environ.get("CRISPR_DB", DEFAULT_DB_PATH))


def connect(path: Path | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(path or db_path(), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA)
    return connection


@contextmanager
def session(path: Path | None = None):
    connection = connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()
