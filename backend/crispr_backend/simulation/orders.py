"""The prototype's 'order your kit' flow.

A real order would wait for a sample to be sequenced. Here, ordering picks a random
demo genome, the simulated customer describes their symptoms, and the analysis runs
on the genome and the description only.
"""

import json
import random
import secrets
import sqlite3
from datetime import UTC, datetime

from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.simulation import symptoms
from crispr_backend.vcf import read_calls_gz


def create_order(connection: sqlite3.Connection) -> dict:
    genome = connection.execute("SELECT id, sex FROM genomes ORDER BY RANDOM() LIMIT 1").fetchone()
    if genome is None:
        raise LookupError("No demo genomes. Run etl.build_genomes first.")
    order_id = secrets.token_urlsafe(9)
    connection.execute(
        "INSERT INTO orders (id, created_at, status, genome_id, sex) VALUES (?, ?, 'processing', ?, ?)",
        (order_id, datetime.now(UTC).isoformat(timespec="seconds"), genome["id"], genome["sex"]),
    )
    return {"id": order_id, "status": "processing"}


def run_order(connection: sqlite3.Connection, analyzer: Analyzer, order_id: str) -> None:
    order = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    try:
        text, source = symptoms.describe(connection, order["genome_id"], random.Random())
        connection.execute("UPDATE orders SET symptoms = ?, symptoms_source = ? WHERE id = ?", (text, source, order_id))
        connection.commit()
        genome = connection.execute("SELECT vcf_gz FROM genomes WHERE id = ?", (order["genome_id"],)).fetchone()
        report = analyzer.analyze(read_calls_gz(genome["vcf_gz"]), text, order["sex"])
        connection.execute(
            "UPDATE orders SET status = 'ready', report_json = ? WHERE id = ?", (json.dumps(report), order_id)
        )
    except Exception as error:  # surface failures to the client instead of leaving the order processing
        connection.execute("UPDATE orders SET status = 'failed', error = ? WHERE id = ?", (repr(error), order_id))
        raise
    finally:
        connection.commit()


def order_view(connection: sqlite3.Connection, order_id: str) -> dict | None:
    order = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if order is None:
        return None
    return {
        "id": order["id"],
        "created_at": order["created_at"],
        "status": order["status"],
        "sex": order["sex"],
        "symptoms": order["symptoms"],
        "symptoms_source": order["symptoms_source"],
        "report": json.loads(order["report_json"]) if order["report_json"] else None,
        "error": order["error"],
    }


def reveal_truth(connection: sqlite3.Connection, order_id: str) -> dict | None:
    """Demo only: what the simulation planted in this order's genome, to check the analysis against."""
    order = connection.execute("SELECT genome_id FROM orders WHERE id = ?", (order_id,)).fetchone()
    if order is None:
        return None
    planted = symptoms.truth(connection, order["genome_id"])
    sample = connection.execute("SELECT sample_id FROM genomes WHERE id = ?", (order["genome_id"],)).fetchone()
    return {
        "background_sample": sample["sample_id"],
        "planted_disease": {"omim_id": planted["omim_id"], "name": planted["disease"]} if planted["omim_id"] else None,
        "planted_variation_ids": json.loads(planted["variant_ids"]),
    }
