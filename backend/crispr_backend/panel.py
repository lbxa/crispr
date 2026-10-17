"""The curated disease panel the prototype supports.

Each disease is caused by small variants (SNVs or short indels) in a single gene,
has a reasonably rich HPO symptom profile, and appears in ClinVar. Repeat
expansions (Huntington, Fragile X) and large deletions (SMA) are excluded because
they do not appear as ordinary VCF records.
"""

from dataclasses import dataclass
from enum import StrEnum


class Inheritance(StrEnum):
    AUTOSOMAL_DOMINANT = "AD"
    AUTOSOMAL_RECESSIVE = "AR"
    X_LINKED_RECESSIVE = "XLR"
    X_LINKED_DOMINANT = "XLD"


class Mechanism(StrEnum):
    """How the variant causes disease; decides whether knocking out the allele could help."""

    LOSS_OF_FUNCTION = "loss_of_function"
    GAIN_OF_FUNCTION = "gain_of_function"
    DOMINANT_NEGATIVE = "dominant_negative"


@dataclass(frozen=True)
class PanelDisease:
    omim_id: str
    name: str
    gene: str
    inheritance: Inheritance
    mechanism: Mechanism = Mechanism.LOSS_OF_FUNCTION


AD, AR, XLR, XLD = Inheritance
GOF, DN = Mechanism.GAIN_OF_FUNCTION, Mechanism.DOMINANT_NEGATIVE

PANEL: tuple[PanelDisease, ...] = (
    PanelDisease("OMIM:603903", "Sickle cell anemia", "HBB", AR),
    PanelDisease("OMIM:219700", "Cystic fibrosis", "CFTR", AR),
    PanelDisease("OMIM:272800", "Tay-Sachs disease", "HEXA", AR),
    PanelDisease("OMIM:261600", "Phenylketonuria", "PAH", AR),
    PanelDisease("OMIM:230800", "Gaucher disease, type I", "GBA1", AR),
    PanelDisease("OMIM:235200", "Hereditary hemochromatosis, type 1", "HFE", AR),
    PanelDisease("OMIM:277900", "Wilson disease", "ATP7B", AR),
    PanelDisease("OMIM:613490", "Alpha-1 antitrypsin deficiency", "SERPINA1", AR),
    PanelDisease("OMIM:201450", "Medium-chain acyl-CoA dehydrogenase deficiency", "ACADM", AR),
    PanelDisease("OMIM:232300", "Pompe disease (glycogen storage disease II)", "GAA", AR),
    PanelDisease("OMIM:249100", "Familial Mediterranean fever", "MEFV", AR),
    PanelDisease("OMIM:271900", "Canavan disease", "ASPA", AR),
    PanelDisease("OMIM:248600", "Maple syrup urine disease", "BCKDHA", AR),
    PanelDisease("OMIM:229600", "Hereditary fructose intolerance", "ALDOB", AR),
    PanelDisease("OMIM:154700", "Marfan syndrome", "FBN1", AD, DN),
    PanelDisease("OMIM:105210", "Hereditary transthyretin amyloidosis", "TTR", AD, GOF),
    PanelDisease("OMIM:115197", "Familial hypertrophic cardiomyopathy 4", "MYBPC3", AD),
    PanelDisease("OMIM:162200", "Neurofibromatosis type 1", "NF1", AD),
    PanelDisease("OMIM:100800", "Achondroplasia", "FGFR3", AD, GOF),
    PanelDisease("OMIM:306900", "Hemophilia B", "F9", XLR),
    PanelDisease("OMIM:306700", "Hemophilia A", "F8", XLR),
    PanelDisease("OMIM:301500", "Fabry disease", "GLA", XLR),
    # HPO lists G6PD deficiency as X-linked dominant, but heterozygous females are
    # usually unaffected, so the prototype treats it as recessive.
    PanelDisease("OMIM:300908", "G6PD deficiency", "G6PD", XLR),
    PanelDisease("OMIM:312750", "Rett syndrome", "MECP2", XLD),
)

PANEL_BY_ID = {disease.omim_id: disease for disease in PANEL}
PANEL_GENES = tuple(sorted({disease.gene for disease in PANEL}))
