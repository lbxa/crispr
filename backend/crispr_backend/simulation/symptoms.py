"""Write a customer's symptom description for a demo genome, from its ground truth.

Genomes with a planted disease describe a frequency-weighted sample of that disease's
HPO symptoms, sometimes with an unrelated complaint mixed in. Controls either describe
vague everyday complaints or a phenocopy: symptoms that resemble a panel disease with
no genetic cause, which tests that the pipeline doesn't diagnose from symptoms alone.

Text comes from Granite when pre-generated (scripts/pregenerate_symptoms.py, slow on
LinuxONE) and otherwise from a template using HPO term names.
"""

import json
import random
import sqlite3

DEFAULT_FREQUENCY = 0.5
# Nonspecific complaints (HPO names) used as noise and for controls.
EVERYDAY_COMPLAINTS = ("Fatigue", "Headache", "Insomnia", "Anxiety", "Back pain", "Nausea", "Dizziness", "Constipation")
TEMPLATES = (
    "For a while now I've been dealing with {items}.",
    "My main problems are {items}.",
    "I've noticed {items}, and it's been getting worse.",
    "Doctors haven't figured it out yet, but I have {items}.",
)

SYMPTOM_PROMPT = (
    "You are a patient filling in a form for a genetic testing company. Describe your health "
    "problems in 2 to 4 plain-language sentences, in the first person, as a non-expert would. "
    "Do not name any disease or use medical jargon."
)


def truth(connection: sqlite3.Connection, genome_id: int) -> sqlite3.Row:
    return connection.execute(
        """SELECT t.omim_id, t.variant_ids, d.name AS disease FROM genome_truth t
           LEFT JOIN diseases d USING (omim_id) WHERE t.genome_id = ?""",
        (genome_id,),
    ).fetchone()


def sample_terms(
    connection: sqlite3.Connection, omim_id: str, rng: random.Random, low: int = 3, high: int = 6
) -> list[str]:
    rows = connection.execute(
        "SELECT hpo_name, frequency FROM disease_phenotypes WHERE omim_id = ?", (omim_id,)
    ).fetchall()
    present = [
        r["hpo_name"]
        for r in rows
        if rng.random() < (r["frequency"] if r["frequency"] is not None else DEFAULT_FREQUENCY)
    ]
    if len(present) < low:
        # Top up with the most frequent terms so every case has something to say.
        common = sorted(rows, key=lambda r: -(r["frequency"] or DEFAULT_FREQUENCY))
        present += [r["hpo_name"] for r in common if r["hpo_name"] not in present][: low - len(present)]
    rng.shuffle(present)
    return present[: rng.randint(low, high)]


def choose_terms(connection: sqlite3.Connection, genome_id: int, rng: random.Random) -> tuple[list[str], str]:
    """Pick the symptoms this customer has. Returns (HPO term names, scenario)."""
    planted = truth(connection, genome_id)
    if planted["omim_id"]:
        terms = sample_terms(connection, planted["omim_id"], rng)
        if rng.random() < 0.3:
            terms.append(rng.choice(EVERYDAY_COMPLAINTS))
        return terms, "disease"
    if rng.random() < 0.5:
        phenocopy = rng.choice(connection.execute("SELECT omim_id FROM diseases").fetchall())["omim_id"]
        return sample_terms(connection, phenocopy, rng, 3, 5), "phenocopy"
    return rng.sample(EVERYDAY_COMPLAINTS, rng.randint(2, 3)), "everyday"


def render_template(terms: list[str], rng: random.Random) -> str:
    items = [term.lower() for term in terms]
    joined = items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]
    return rng.choice(TEMPLATES).format(items=joined)


def describe(connection: sqlite3.Connection, genome_id: int, rng: random.Random) -> tuple[str, str]:
    """Return (symptom text, source) for an order: pre-generated Granite text if available, else a template."""
    stored = connection.execute(
        "SELECT text, source FROM genome_symptoms WHERE genome_id = ? ORDER BY RANDOM() LIMIT 1", (genome_id,)
    ).fetchone()
    if stored:
        return stored["text"], stored["source"]
    terms, _scenario = choose_terms(connection, genome_id, rng)
    return render_template(terms, rng), "template"


def granite_description(granite, terms: list[str]) -> str:
    return granite.chat(
        SYMPTOM_PROMPT, "My symptoms (clinical names): " + json.dumps(terms), max_tokens=120, temperature=0.7
    )
