"""Symptoms text -> HPO terms -> similarity to each panel disease's symptom profile."""

import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from functools import cache

from pyhpo import HPOSet, HPOTerm, Ontology

PHENOTYPIC_ABNORMALITY = "HP:0000118"
TOKEN = re.compile(r"[a-z0-9]+")
MAX_NGRAM = 7
# Single words that are HPO synonyms but too ambiguous on their own in free text.
AMBIGUOUS_SINGLE_WORDS = {
    "short",
    "small",
    "large",
    "tall",
    "abnormal",
    "absent",
    "increased",
    "decreased",
    "high",
    "low",
    "weak",
}


def stem(token: str) -> str:
    return token[:-1] if len(token) > 3 and token.endswith("s") and not token.endswith("ss") else token


def tokens(text: str) -> list[str]:
    return [stem(token) for token in TOKEN.findall(text.lower())]


@dataclass(frozen=True)
class ExtractedTerm:
    id: str
    name: str
    matched_text: str


@cache
def _ontology_index() -> tuple[dict[str, str], dict[str, set[str]]]:
    """(normalized name or synonym -> HPO id, token -> keys containing it) for phenotype terms."""
    Ontology()
    root = Ontology.get_hpo_object(PHENOTYPIC_ABNORMALITY)
    by_key: dict[str, str] = {}
    keys_by_token: dict[str, set[str]] = defaultdict(set)
    for term in Ontology:
        if term.is_obsolete or term == root or not term.child_of(root):
            continue
        for label in (term.name, *term.synonym):
            words = tokens(label)
            if not words or (len(words) == 1 and (len(words[0]) < 4 or words[0] in AMBIGUOUS_SINGLE_WORDS)):
                continue
            key = " ".join(words)
            by_key.setdefault(key, term.id)  # names are indexed before synonyms, so names win
            for word in words:
                keys_by_token[word].add(key)
    return by_key, keys_by_token


def most_specific(terms: list[ExtractedTerm]) -> list[ExtractedTerm]:
    """Drop terms that are ancestors of another extracted term (keep 'Focal seizure' over 'Seizure')."""
    objects = {term.id: Ontology.get_hpo_object(term.id) for term in terms}
    return [
        term
        for term in terms
        if not any(other.id != term.id and objects[other.id].child_of(objects[term.id]) for other in terms)
    ]


def extract_from_text(text: str) -> list[ExtractedTerm]:
    """Find HPO term names and synonyms mentioned verbatim (after normalization) in free text."""
    by_key, _ = _ontology_index()
    words = tokens(text)
    found: dict[str, ExtractedTerm] = {}
    covered = [False] * len(words)
    # Longest matches first so "muscle weakness" beats "weakness".
    for size in range(min(MAX_NGRAM, len(words)), 0, -1):
        for start in range(len(words) - size + 1):
            if any(covered[start : start + size]):
                continue
            key = " ".join(words[start : start + size])
            hpo_id = by_key.get(key)
            if hpo_id and hpo_id not in found:
                term = Ontology.get_hpo_object(hpo_id)
                found[hpo_id] = ExtractedTerm(term.id, term.name, key)
                covered[start : start + size] = [True] * size
    return most_specific(list(found.values()))


def map_phrase(phrase: str) -> ExtractedTerm | None:
    """Map one short clinical phrase (e.g. from Granite) to the closest HPO term."""
    by_key, keys_by_token = _ontology_index()
    words = tokens(phrase)
    if not words:
        return None
    key = " ".join(words)
    if key in by_key:
        term = Ontology.get_hpo_object(by_key[key])
        return ExtractedTerm(term.id, term.name, phrase)
    # Fall back to the label with the best token overlap (Jaccard), requiring a decent match.
    query = set(words)
    candidates = set().union(*(keys_by_token.get(word, set()) for word in query))
    best_key, best_score = None, 0.0
    for candidate in candidates:
        candidate_words = set(candidate.split())
        score = len(query & candidate_words) / len(query | candidate_words)
        if score > best_score or (score == best_score and best_key and len(candidate) < len(best_key)):
            best_key, best_score = candidate, score
    if best_key is None or best_score < 0.5:
        return None
    term = Ontology.get_hpo_object(by_key[best_key])
    return ExtractedTerm(term.id, term.name, phrase)


def extract_from_phrases(phrases: list[str]) -> list[ExtractedTerm]:
    terms = {term.id: term for term in (map_phrase(phrase) for phrase in phrases) if term}
    return most_specific(list(terms.values()))


@dataclass(frozen=True)
class PhenotypeMatch:
    omim_id: str
    score: float  # Resnik best-match average; higher = more similar
    rank: int  # 1 = best match among panel diseases
    matched_terms: list[dict]  # patient terms that fit the disease profile


class DiseaseProfiles:
    def __init__(self, connection: sqlite3.Connection):
        Ontology()
        terms: dict[str, list[str]] = defaultdict(list)
        for row in connection.execute("SELECT omim_id, hpo_id FROM disease_phenotypes"):
            terms[row["omim_id"]].append(row["hpo_id"])
        self.sets = {omim_id: HPOSet.from_queries(ids) for omim_id, ids in terms.items()}

    def rank(self, patient_terms: list[ExtractedTerm]) -> dict[str, PhenotypeMatch]:
        if not patient_terms:
            return {}
        patient = HPOSet.from_queries([term.id for term in patient_terms])
        scores = {
            omim_id: patient.similarity(profile, kind="omim", method="resnik") for omim_id, profile in self.sets.items()
        }
        ordered = sorted(scores, key=scores.get, reverse=True)
        return {
            omim_id: PhenotypeMatch(
                omim_id=omim_id,
                score=round(scores[omim_id], 3),
                rank=position,
                matched_terms=self._explain(patient, self.sets[omim_id]),
            )
            for position, omim_id in enumerate(ordered, start=1)
        }

    @staticmethod
    def _explain(patient: HPOSet, profile: HPOSet) -> list[dict]:
        """Patient terms that equal, or are a more/less specific version of, a disease term."""
        matched = []
        for term in patient:
            related: HPOTerm | None = next(
                (d for d in profile if d == term or term.child_of(d) or d.child_of(term)), None
            )
            if related is not None:
                matched.append({"patient_term": term.name, "disease_term": related.name, "hpo_id": related.id})
        return matched
