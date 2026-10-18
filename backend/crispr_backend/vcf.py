"""Single-sample VCF reading, including bounded whole-genome scans on s390x."""

import gzip
import io
import re
import shlex
import zlib
from collections.abc import Callable, Collection, Iterable, Iterator
from dataclasses import dataclass
from typing import BinaryIO, Literal

Locus = tuple[str, int, str, str]
ObservedAllele = tuple[Locus, int, tuple[int, ...], bool]
ModelProfile = Literal["male", "female"]
MAX_SAMPLE_METADATA_BYTES = 64 * 1024


class VcfValidationError(ValueError):
    """An upload cannot be analyzed safely as a single-sample GRCh38 VCF."""


class VcfCancelled(Exception):
    """The caller cancelled the scan; no partial result should be published."""


@dataclass(frozen=True)
class Call:
    """One alternate allele observed in the sample."""

    chrom: str  # without "chr" prefix
    pos: int
    ref: str
    alt: str
    alt_copies: int  # 1 = heterozygous, 2 = homozygous (or 1 for hemizygous)
    haplotypes: tuple[int, ...]  # phased haplotype indexes carrying the allele; () if unphased
    hemizygous: bool = False


@dataclass(frozen=True)
class VcfLimits:
    """Resource limits are independent of the compressed upload size."""

    max_line_bytes: int = 4 * 1024 * 1024
    max_uncompressed_bytes: int = 40 * 1024**3
    max_records: int = 200_000_000
    max_retained_calls: int = 100_000
    progress_interval_records: int = 10_000

    def __post_init__(self):
        if (
            min(
                self.max_line_bytes,
                self.max_uncompressed_bytes,
                self.max_records,
                self.max_retained_calls,
                self.progress_interval_records,
            )
            < 1
        ):
            raise ValueError("VCF limits must be positive")


DEFAULT_VCF_LIMITS = VcfLimits()


@dataclass(frozen=True)
class VcfProgress:
    records_scanned: int
    variants_checked: int
    retained_calls: int
    uncompressed_bytes: int


@dataclass(frozen=True)
class VcfScanResult:
    calls: tuple[Call, ...]
    records_scanned: int
    variants_checked: int
    uncompressed_bytes: int
    model_profile: ModelProfile | None = None


def _sample_model_profile(headers: Iterable[str], sample_id: str) -> ModelProfile | None:
    """Resolve explicit SAMPLE Sex metadata for display, never clinical inference."""
    profile: ModelProfile | None = None
    for header in headers:
        if not header.startswith("##SAMPLE=<") or not header.endswith(">"):
            return None
        lexer = shlex.shlex(header[len("##SAMPLE=<") : -1], posix=True)
        lexer.whitespace = ","
        lexer.whitespace_split = True
        lexer.commenters = ""
        attributes: dict[str, str] = {}
        try:
            for field in lexer:
                key, separator, value = field.partition("=")
                key = key.strip()
                if not separator or key in attributes:
                    return None
                attributes[key] = value.strip()
        except ValueError:
            return None
        if attributes.get("ID") != sample_id:
            continue
        sex = attributes.get("Sex", "").casefold()
        declared: ModelProfile
        if sex in ("female", "f"):
            declared = "female"
        elif sex in ("male", "m"):
            declared = "male"
        else:
            return None
        if profile is not None and profile != declared:
            return None
        profile = declared
    return profile


def with_sample_sex(text: str, sample_id: str, sex: str) -> str:
    """Add `##SAMPLE=<ID=…,Sex=…>` before the column header, unless the file already has SAMPLE
    metadata. That is the explicit sex scan_vcf reads, so uploads of demo genomes show the right
    avatar and karyotype."""
    lines = text.split("\n")
    if any(line.startswith("##SAMPLE=") for line in lines):
        return text
    columns = next((index for index, line in enumerate(lines) if line.startswith("#CHROM")), None)
    if columns is None:
        return text
    lines.insert(columns, f"##SAMPLE=<ID={sample_id},Sex={sex}>")
    return "\n".join(lines)


def normalize_chrom(chrom: str) -> str:
    return chrom.removeprefix("chr")


def parse_genotype(genotype: str, alt_index: int) -> tuple[int, tuple[int, ...], bool]:
    """Return (copies of alt_index, phased haplotypes carrying it, hemizygous)."""
    phased = "|" in genotype
    alleles = genotype.replace("|", "/").split("/")
    copies = sum(1 for allele in alleles if allele == str(alt_index))
    haplotypes = tuple(i for i, allele in enumerate(alleles) if allele == str(alt_index)) if phased else ()
    return copies, haplotypes, len(alleles) == 1


def read_calls(text: str) -> list[Call]:
    """Parse VCF text into calls for the first sample, skipping reference-only genotypes."""
    return list(iter_calls(io.StringIO(text)))


def iter_calls(lines: Iterable[str]) -> Iterator[Call]:
    """Legacy panel reader for callers that already own a text stream."""
    for line in lines:
        if line.startswith("#") or not line.strip():
            continue
        fields = line.rstrip("\n").split("\t")
        for locus, copies, haplotypes, hemizygous in _observed_alleles(fields, strict=False):
            yield Call(*locus, copies, haplotypes, hemizygous)


def _observed_alleles(fields: list[str], *, strict: bool) -> Iterator[ObservedAllele]:
    if len(fields) < 10 or (strict and len(fields) != 10):
        raise VcfValidationError("VCF requires exactly one sample column")
    chrom, pos, _id, ref, alts, _qual, filt, _info, fmt, sample = fields[:10]
    if filt not in ("PASS", ".", ""):
        return
    try:
        position = int(pos)
        if position < 1 or not chrom or not ref or not alts:
            raise ValueError
        keys = fmt.split(":")
        values = sample.split(":")
        if strict and "GT" not in keys:
            raise VcfValidationError("VCF records require a GT genotype field")
        genotype = values[keys.index("GT")] if "GT" in keys else values[0]
    except (ValueError, IndexError):
        raise VcfValidationError("VCF record has an invalid position or genotype field") from None
    alternates = alts.split(",")
    if strict:
        alleles = genotype.replace("|", "/").split("/")
        if (
            not genotype
            or len(alleles) > 2
            or ("|" in genotype and "/" in genotype)
            or any(allele != "." and (not allele.isascii() or not allele.isdigit()) for allele in alleles)
            or any(allele != "." and len(allele) > 9 for allele in alleles)
            or any(allele != "." and int(allele) > len(alternates) for allele in alleles)
            or any(not alt for alt in alternates)
        ):
            raise VcfValidationError("VCF record has an invalid genotype or alternate allele")
    for index, alt in enumerate(alternates, start=1):
        copies, haplotypes, hemizygous = parse_genotype(genotype, index)
        if copies:
            yield (normalize_chrom(chrom), position, ref.upper(), alt.upper()), copies, haplotypes, hemizygous


def read_calls_gz(blob: bytes) -> list[Call]:
    """Legacy panel API; decompress incrementally rather than creating another full string."""
    with gzip.GzipFile(fileobj=io.BytesIO(blob), mode="rb") as compressed:
        with io.TextIOWrapper(compressed, encoding="utf-8") as text:
            return list(iter_calls(text))


def scan_vcf(
    source: BinaryIO,
    *,
    relevant_loci: Collection[Locus],
    compressed: bool = False,
    on_progress: Callable[[VcfProgress], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    limits: VcfLimits = DEFAULT_VCF_LIMITS,
) -> VcfScanResult:
    """Scan a whole genome, retaining only exact reference-index matches.

    The caller owns ``source`` and its lifetime. Gzip/BGZF is decompressed one
    bounded line at a time, including every member's integrity check. Missing
    assembly metadata assumes GRCh38, as in the existing API; explicit GRCh37 or
    hg19 declarations are rejected. Input need not be sorted. No genome content
    or sample names are exposed through progress or exception messages.
    """
    reader = gzip.GzipFile(fileobj=source, mode="rb") if compressed else source
    retained: dict[Locus, Call] = {}
    records_scanned = variants_checked = uncompressed_bytes = 0
    line_number = 0
    saw_format = saw_columns = False
    sample_headers: list[str] = []
    sample_metadata_bytes = 0
    model_profile: ModelProfile | None = None

    def report_progress():
        if on_progress is not None:
            on_progress(VcfProgress(records_scanned, variants_checked, len(retained), uncompressed_bytes))

    try:
        report_progress()
        while True:
            if cancelled is not None and cancelled():
                raise VcfCancelled("VCF scan cancelled")
            raw = reader.readline(limits.max_line_bytes + 1)
            if not raw:
                break
            line_number += 1
            uncompressed_bytes += len(raw)
            if len(raw) > limits.max_line_bytes:
                raise VcfValidationError("VCF record exceeds the line size limit")
            if uncompressed_bytes > limits.max_uncompressed_bytes:
                raise VcfValidationError("VCF exceeds the decompressed size limit")
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError:
                raise VcfValidationError("VCF must contain UTF-8 text") from None
            if not line:
                continue
            if line_number == 1:
                if not re.fullmatch(r"##fileformat=VCFv4\.[0-5]", line):
                    raise VcfValidationError("VCF must start with a supported fileformat header")
                saw_format = True
                continue
            if line.startswith("##"):
                if saw_columns:
                    raise VcfValidationError("VCF metadata must precede the column header")
                if re.search(r"(?:GRCh37|hg19|b37|hs37d5)", line, flags=re.IGNORECASE) and (
                    line.startswith("##reference=") or line.startswith("##contig=")
                ):
                    raise VcfValidationError("VCF reference assembly must be GRCh38")
                if line.startswith("##SAMPLE="):
                    sample_metadata_bytes += len(raw)
                    if sample_metadata_bytes <= MAX_SAMPLE_METADATA_BYTES:
                        sample_headers.append(line)
                    else:
                        sample_headers.clear()
                continue
            if line.startswith("#"):
                columns = line.split("\t")
                if (
                    saw_columns
                    or columns[:9] != ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT"]
                    or len(columns) != 10
                    or not columns[9]
                ):
                    raise VcfValidationError("VCF requires a valid header with exactly one sample")
                model_profile = _sample_model_profile(sample_headers, columns[9])
                sample_headers.clear()
                saw_columns = True
                continue
            if not saw_columns:
                raise VcfValidationError("VCF requires a column header before records")
            records_scanned += 1
            if records_scanned > limits.max_records:
                raise VcfValidationError("VCF exceeds the record count limit")
            for locus, copies, haplotypes, hemizygous in _observed_alleles(line.split("\t"), strict=True):
                variants_checked += 1
                if locus not in relevant_loci:
                    continue
                call = Call(*locus, copies, haplotypes, hemizygous)
                previous = retained.get(locus)
                if previous is not None and previous != call:
                    raise VcfValidationError("VCF has conflicting genotypes for a relevant variant")
                retained[locus] = call
                if len(retained) > limits.max_retained_calls:
                    raise VcfValidationError("VCF exceeds the retained variant limit")
            if records_scanned % limits.progress_interval_records == 0:
                report_progress()
        if not saw_format or not saw_columns:
            raise VcfValidationError("VCF requires fileformat and single-sample column headers")
        if cancelled is not None and cancelled():
            raise VcfCancelled("VCF scan cancelled")
        report_progress()
        return VcfScanResult(
            tuple(retained.values()), records_scanned, variants_checked, uncompressed_bytes, model_profile
        )
    except (gzip.BadGzipFile, EOFError, zlib.error):
        raise VcfValidationError("VCF gzip stream is invalid or incomplete") from None
    finally:
        if compressed:
            reader.close()
