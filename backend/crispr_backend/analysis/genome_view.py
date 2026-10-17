"""BED-compatible finding intervals and bounded forward-strand GRCh38 context."""

from typing import Literal, TypedDict

# Primary GRCh38/hg38 lengths: UCSC goldenPath/hg38/bigZips/hg38.chrom.sizes.
CHROMOSOME_LENGTHS = dict(
    zip(
        [*(str(index) for index in range(1, 23)), "X", "Y", "MT"],
        [
            248956422,
            242193529,
            198295559,
            190214555,
            181538259,
            170805979,
            159345973,
            145138636,
            138394717,
            133797422,
            135086622,
            133275309,
            114364328,
            107043718,
            101991189,
            90338345,
            83257441,
            80373285,
            58617616,
            64444167,
            46709983,
            50818468,
            156040895,
            57227415,
            16569,
        ],
        strict=True,
    )
)
CONTEXT_FLANK = 256
MAX_CONTEXT_BASES = 1536


class ReferenceContext(TypedDict):
    start: int
    end: int
    bases: str


class RegionAnnotation(TypedDict):
    gene: str
    disease: str
    tier: str


class GenomeRegion(TypedDict):
    id: str
    chromosome: str
    start: int
    end: int
    reference: str
    alternate: str
    clinical_significance: str
    zygosity: str
    annotations: list[RegionAnnotation]
    reference_context: ReferenceContext | None


class Chromosome(TypedDict):
    id: str
    length: int


class GenomeView(TypedDict):
    version: Literal[1]
    assembly: Literal["GRCh38"]
    coordinate_system: Literal["zero-based-half-open"]
    chromosomes: list[Chromosome]
    regions: list[GenomeRegion]


def reference_context(region: dict | None, chromosome: str, start: int, ref: str) -> ReferenceContext | None:
    """Return only verified reference bases; absent/mismatched context remains unknown."""
    if region is None or region["chrom"] != chromosome or len(ref) + 2 * CONTEXT_FLANK > MAX_CONTEXT_BASES:
        return None
    available_start = region["start"] - 1
    sequence = region["sequence"]
    available_end = available_start + len(sequence)
    end = start + len(ref)
    if (
        available_end != region["end"]
        or available_start < 0
        or available_end > CHROMOSOME_LENGTHS[chromosome]
        or start < available_start
        or end > available_end
        or sequence[start - available_start : end - available_start] != ref
    ):
        return None
    left, right = max(available_start, start - CONTEXT_FLANK), min(available_end, end + CONTEXT_FLANK)
    bases = sequence[left - available_start : right - available_start]
    if any(base not in "ACGTN" for base in bases):
        return None
    return {"start": left, "end": right, "bases": bases}


def build_genome_view(findings: list[dict], gene_regions: dict[str, dict]) -> GenomeView:
    """One exact reference interval per allele; disease annotations are deduplicated."""
    regions: dict[tuple[str, int, str, str], GenomeRegion] = {}
    for finding in findings:
        annotation = RegionAnnotation(gene=finding["gene"], disease=finding["disease"], tier=finding["tier"])
        for hit in finding["variants"]:
            chrom, start, ref, alt = hit["chrom"], hit["pos"] - 1, hit["ref"], hit["alt"]
            end = start + len(ref)
            if chrom not in CHROMOSOME_LENGTHS or not ref or start < 0 or end > CHROMOSOME_LENGTHS[chrom]:
                raise ValueError("Finding lies outside the GRCh38 primary assembly")
            key = chrom, start, ref, alt
            region = regions.get(key)
            if region is None:
                region = GenomeRegion(
                    id=f"GRCh38:{chrom}:{start}:{end}:{hit['variation_id']}",
                    chromosome=chrom,
                    start=start,
                    end=end,
                    reference=ref,
                    alternate=alt,
                    clinical_significance=hit["significance"],
                    zygosity=hit["zygosity"],
                    annotations=[],
                    reference_context=None,
                )
                regions[key] = region
            if annotation not in region["annotations"]:
                region["annotations"].append(annotation)
            if region["reference_context"] is None:
                region["reference_context"] = reference_context(gene_regions.get(finding["gene"]), chrom, start, ref)
    order = {chrom: index for index, chrom in enumerate(CHROMOSOME_LENGTHS)}
    return {
        "version": 1,
        "assembly": "GRCh38",
        "coordinate_system": "zero-based-half-open",
        "chromosomes": [{"id": chrom, "length": length} for chrom, length in CHROMOSOME_LENGTHS.items()],
        "regions": sorted(regions.values(), key=lambda item: (order[item["chromosome"]], item["start"], item["id"])),
    }
