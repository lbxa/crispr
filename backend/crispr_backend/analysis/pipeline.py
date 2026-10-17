"""Genome + symptoms -> report. Never reads simulation ground truth (genome_truth)."""

import sqlite3
from dataclasses import asdict

import requests

from crispr_backend.analysis import crispr, genotype, phenotype
from crispr_backend.analysis.genome_view import build_genome_view
from crispr_backend.llm import chat_json, get_llm
from crispr_backend.panel import Inheritance, Mechanism
from crispr_backend.vcf import Call, ModelProfile

# A genotype finding "likely explains" the symptoms when the disease ranks this high
# by symptom similarity among all panel diseases. Tuned with scripts/evaluate.py.
LIKELY_MAX_RANK = 3
MAX_VARIANTS_TO_EDIT = 2

DISCLAIMER = (
    "Research prototype using simulated genomes. Not a medical diagnosis or treatment "
    "recommendation; findings must be confirmed by clinical testing and a genetic counselor."
)

EXTRACT_SYSTEM = (
    "You convert a patient's description of their health into clinical findings. "
    "Reply with only a JSON array of short clinical terms in English medical vocabulary, "
    'for example ["Recurrent fever", "Abdominal pain", "Hepatomegaly"]. '
    "Include only findings the patient actually describes. Do not guess diagnoses."
)


class Analyzer:
    """Holds reference data in memory; build once per process."""

    def __init__(self, connection: sqlite3.Connection):
        self.variants = genotype.VariantIndex(connection)
        self.profiles = phenotype.DiseaseProfiles(connection)
        self.regions = {row["gene"]: dict(row) for row in connection.execute("SELECT * FROM gene_regions")}

    def extract_symptoms(self, text: str, use_llm: bool = True) -> tuple[list[phenotype.ExtractedTerm], str]:
        """Returns the terms and how they were found: 'keyword', or the model's name ('gemini', 'granite')."""
        verbatim = phenotype.extract_from_text(text)
        llm = get_llm() if use_llm and text.strip() else None
        if llm is None:
            return verbatim, "keyword"
        try:
            phrases = chat_json(llm, EXTRACT_SYSTEM, text, max_tokens=120)
        except (RuntimeError, requests.RequestException):
            phrases = None  # model unreachable or over quota: fall back rather than fail the order
        if not isinstance(phrases, list):
            return verbatim, "keyword"
        # Models sometimes return [{"term": "Fever"}] instead of ["Fever"].
        strings = [
            item if isinstance(item, str) else next((v for v in item.values() if isinstance(v, str)), "")
            for item in phrases
            if isinstance(item, (str, dict))
        ]
        mapped = phenotype.extract_from_phrases(strings)
        merged = {term.id: term for term in verbatim + mapped}
        return phenotype.most_specific(list(merged.values())), llm.name

    def analyze(
        self,
        calls: list[Call],
        symptoms: str,
        sex: str | None,
        use_llm: bool = True,
        *,
        variants_checked: int | None = None,
        model_profile: ModelProfile | None = None,
    ) -> dict:
        """`use_llm=False` skips the language model (keyword matching only), for fast iteration."""
        if variants_checked is not None and variants_checked < len(calls):
            raise ValueError("variants_checked cannot be less than retained calls")
        terms, extraction = self.extract_symptoms(symptoms or "", use_llm)
        phenotype_matches = self.profiles.rank(terms)
        findings = []
        for finding in genotype.assess(self.variants, calls, sex):
            match = phenotype_matches.get(finding.omim_id)
            findings.append(self._finding(finding, match))

        order = {"likely": 0, "possible": 1, "carrier": 2}
        findings.sort(key=lambda f: (order[f["tier"]], f["phenotype"]["rank"] if f["phenotype"] else 99))
        top_phenotype = sorted(phenotype_matches.values(), key=lambda m: m.rank)[:3]

        report = {
            "conclusion": self._conclusion(findings),
            "findings": findings,
            "genome_view": build_genome_view(findings, self.regions),
            "symptoms": {
                "text": symptoms,
                "extraction": extraction,
                "terms": [asdict(term) for term in terms],
                "closest_panel_diseases": [
                    {"omim_id": m.omim_id, "disease": self.variants.diseases[m.omim_id]["name"], "score": m.score}
                    for m in top_phenotype
                ],
            },
            "genome": {
                "variants_checked": len(calls) if variants_checked is None else variants_checked,
                "panel_genes": sorted(self.regions),
                "model_profile": model_profile,
            },
            "disclaimer": DISCLAIMER,
        }
        report["summary"] = self._summary(report)
        return report

    def _finding(self, finding: genotype.GenotypeFinding, match: phenotype.PhenotypeMatch | None) -> dict:
        if finding.status is genotype.GenotypeStatus.CARRIER:
            tier = "carrier"
        elif match and match.rank <= LIKELY_MAX_RANK and match.matched_terms:
            tier = "likely"
        else:
            tier = "possible"

        edits = []
        if tier != "carrier":
            region = self.regions[finding.gene]
            unique = {hit.variation_id: hit for hit in finding.hits}.values()
            for hit in sorted(unique, key=lambda h: -h.stars)[:MAX_VARIANTS_TO_EDIT]:
                plan = crispr.plan_edit(
                    region["sequence"],
                    region["start"],
                    hit.pos,
                    hit.ref,
                    hit.alt,
                    Inheritance(finding.inheritance),
                    Mechanism(finding.mechanism),
                )
                edits.append({"variation_id": hit.variation_id, "variant": hit.name, **asdict(plan)})

        return {
            "tier": tier,
            "omim_id": finding.omim_id,
            "disease": finding.disease,
            "gene": finding.gene,
            "inheritance": finding.inheritance.value,
            "genotype": {"status": finding.status.value, "explanation": finding.explanation},
            "variants": [asdict(hit) for hit in finding.hits],
            "phenotype": (
                {"score": match.score, "rank": match.rank, "matched_terms": match.matched_terms} if match else None
            ),
            "crispr": edits,
        }

    @staticmethod
    def _conclusion(findings: list[dict]) -> dict:
        tiers = [f["tier"] for f in findings]
        if "likely" in tiers:
            return {"status": "likely_genetic_cause", "label": "A genetic cause likely explains these symptoms"}
        if "possible" in tiers:
            return {
                "status": "genetic_finding",
                "label": "Disease-causing variants found, but they don't clearly match the symptoms",
            }
        if "carrier" in tiers:
            return {"status": "carrier_only", "label": "No genetic cause found; carrier of a recessive condition"}
        return {"status": "no_finding", "label": "No genetic cause found in the screened genes"}

    @staticmethod
    def _summary(report: dict) -> dict:
        # Template, not Granite: on LinuxONE Granite runs at ~1 token/s and garbled
        # variant facts in testing, so the user-facing summary is built from the findings.
        lines = [report["conclusion"]["label"] + "."]
        for f in report["findings"]:
            if f["tier"] == "carrier":
                lines.append(
                    f"You carry one copy of a variant linked to {f['disease']} ({f['gene']}); carriers usually have no symptoms."
                )
            else:
                strategy = f["crispr"][0]["strategy"].lower() if f["crispr"] else "no suitable edit found"
                lines.append(
                    f"{f['disease']} ({f['gene']}): {f['genotype']['explanation']}. Proposed approach: {strategy}."
                )
        return {"text": " ".join(lines), "source": "template"}
