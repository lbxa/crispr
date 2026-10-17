from crispr_backend import db
from crispr_backend.analysis.phenotype import DiseaseProfiles, extract_from_phrases, extract_from_text, map_phrase


def test_extracts_terms_from_free_text_including_plurals():
    names = {term.name for term in extract_from_text("I keep getting seizures and I have abdominal pain.")}
    assert {"Seizure", "Abdominal pain"} <= names


def test_keeps_the_most_specific_term():
    names = {term.name for term in extract_from_text("I have pain and abdominal pain")}
    assert "Abdominal pain" in names and "Pain" not in names


def test_maps_clinical_phrases_and_rejects_nonsense():
    assert map_phrase("Recurrent fevers").name == "Recurrent fever"
    assert map_phrase("purple elephant") is None
    assert [t.name for t in extract_from_phrases(["Joint pain", "Joint pain"])] == ["Arthralgia"]


def test_ranks_the_matching_disease_first(database):
    with db.session(database) as connection:
        profiles = DiseaseProfiles(connection)
    terms = extract_from_text("I get recurrent fevers with abdominal pain and my joints ache")
    ranking = profiles.rank(terms)
    assert ranking["OMIM:249100"].rank == 1
    assert ranking["OMIM:249100"].matched_terms
    assert profiles.rank([]) == {}
