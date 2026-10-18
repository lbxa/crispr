"""Upload parsing uses synthetic variants only; no patient files or network access."""

import gzip
import io
import struct
import traceback
import zlib

import pytest
from conftest import vcf

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.vcf import (
    Call,
    VcfCancelled,
    VcfLimits,
    VcfValidationError,
    iter_calls,
    read_calls,
    read_calls_gz,
    scan_vcf,
)

HEADER = b"##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n"
KNOWN = ("1", 100, "A", "G")
RECORD = b"chr1\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0|1\n"


@pytest.mark.parametrize("compressed", [False, True])
@pytest.mark.parametrize("sex,expected", [("female", "female"), ("Male", "male"), ("F", "female"), ("M", "male")])
def test_scan_reads_only_the_selected_samples_declared_model_profile(compressed, sex, expected):
    metadata = f'##SAMPLE=<ID=S1,Sex="{sex}",Description="A sample, with additional metadata">\n'.encode()
    content = HEADER.replace(b"#CHROM", metadata + b"#CHROM") + RECORD
    result = scan_vcf(
        BoundedBytesIO(gzip.compress(content) if compressed else content),
        relevant_loci={KNOWN},
        compressed=compressed,
    )
    assert result.model_profile == expected
    assert result.calls == (Call(*KNOWN, 1, (1,)),)


@pytest.mark.parametrize(
    "metadata",
    [
        b"",
        b"##SAMPLE=<ID=OTHER,Sex=female>\n",
        b"##SAMPLE=<ID=S1,Sex=unknown>\n",
        b'##SAMPLE=<ID=S1,Description="Sex=female, not an actual sex field">\n',
        b"##SAMPLE=<ID=S1,Sex=male>\n##SAMPLE=<ID=S1,Sex=female>\n",
        b"##SAMPLE=<ID=S1,Sex=male,Sex=female>\n",
        b'##SAMPLE=<ID=S1,Sex="female>\n',
        b"##SAMPLE=<ID=S1,Sex=female,Description=" + b"x" * (64 * 1024) + b">\n",
    ],
    ids=[
        "absent",
        "other-sample",
        "unknown",
        "description-only",
        "conflicting",
        "duplicate-key",
        "malformed",
        "oversized",
    ],
)
def test_missing_ambiguous_or_excessive_metadata_leaves_model_profile_unknown(metadata):
    content = HEADER.replace(b"#CHROM", metadata + b"#CHROM") + RECORD
    result = scan_vcf(io.BytesIO(content), relevant_loci={KNOWN})
    assert result.model_profile is None


class BoundedBytesIO(io.BytesIO):
    def read(self, size: int | None = -1):
        assert size is not None and 0 <= size <= 4 * 1024 * 1024, "whole-file reads are forbidden"
        return super().read(size)

    def readline(self, size: int | None = -1):
        assert size is not None and 0 <= size <= 4 * 1024 * 1024 + 1, "whole-line reads must have a limit"
        return super().readline(size)


def bgzf_member(data: bytes) -> bytes:
    """Actual BGZF gzip member with BC extra field, not just a .gz extension."""
    compressor = zlib.compressobj(wbits=-15)
    body = compressor.compress(data) + compressor.flush()
    header = b"\x1f\x8b\x08\x04" + b"\x00" * 4 + b"\x00\xff\x06\x00BC\x02\x00"
    trailer = struct.pack("<II", zlib.crc32(data), len(data))
    return header + struct.pack("<H", len(header) + 2 + len(body) + len(trailer) - 1) + body + trailer


@pytest.mark.parametrize("compression", ["plain", "gzip", "members", "bgzf"])
def test_stream_scan_preserves_total_counts_and_retains_only_known_loci(compression):
    parts = [
        HEADER + RECORD,
        b"chr1\t101\t.\tA\tT,C\t.\tPASS\t.\tGT:DP\t1/2:30\n",
        b"chr1\t102\t.\tA\tG\t.\tPASS\t.\tGT\t0/0\n",
        b"chr1\t103\t.\tA\tG\t.\tLowQual\t.\tGT\t1/1\n",
    ]
    raw = b"".join(parts)
    if compression == "plain":
        payload = raw
    elif compression == "gzip":
        payload = gzip.compress(raw)
    elif compression == "members":
        payload = b"".join(gzip.compress(part) for part in parts)
    else:
        # Blocks may split records and include the empty BGZF EOF member.
        payload = b"".join(bgzf_member(raw[start : start + 37]) for start in range(0, len(raw), 37)) + bgzf_member(b"")
    source = BoundedBytesIO(payload)
    progress = []
    result = scan_vcf(
        source,
        relevant_loci={KNOWN},
        compressed=compression != "plain",
        on_progress=progress.append,
        limits=VcfLimits(progress_interval_records=2),
    )
    assert result.calls == (Call(*KNOWN, 1, (1,)),)
    assert result.records_scanned == 4
    assert result.variants_checked == 3
    assert result.uncompressed_bytes == len(raw)
    assert [(p.records_scanned, p.variants_checked, p.retained_calls) for p in progress] == [
        (0, 0, 0),
        (2, 3, 1),
        (4, 3, 1),
        (4, 3, 1),
    ]
    assert not source.closed


def test_identical_duplicate_is_retained_once_but_scanned_counts_still_include_it():
    result = scan_vcf(io.BytesIO(HEADER + RECORD * 2), relevant_loci={KNOWN})
    assert len(result.calls) == 1
    assert result.records_scanned == result.variants_checked == 2


def test_conflicting_duplicate_is_rejected_instead_of_creating_false_biallelic_finding():
    with pytest.raises(VcfValidationError, match="conflicting genotypes"):
        scan_vcf(io.BytesIO(HEADER + RECORD + RECORD.replace(b"0|1", b"1|0")), relevant_loci={KNOWN})


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        RECORD,
        HEADER.replace(b"##fileformat=VCFv4.2\n", b""),
        HEADER.replace(b"S1\n", b"S1\tS2\n"),
        HEADER.replace(b"GRCh38", b"GRCh37"),
        HEADER.replace(b"GRCh38", b"hg19"),
        HEADER + RECORD.replace(b"100", b"-100"),
        HEADER + RECORD.replace(b"0|1", b"0|2"),
        HEADER + RECORD.replace(b"0|1", b"0/1|1"),
        HEADER + RECORD.replace(b"0|1", b"1/1/1"),
        HEADER + RECORD.replace(b"0|1", b"0/"),
        HEADER + RECORD.replace(b"GT", b"DP"),
        HEADER + RECORD.replace(b"0|1", b"\xff"),
        HEADER + RECORD.replace(b"0|1", b"0|1\t1/1"),
        HEADER + b"##reference=GRCh38\n",
    ],
)
def test_rejects_invalid_single_sample_vcf_without_exposing_sample_or_content(payload):
    with pytest.raises(VcfValidationError) as error:
        scan_vcf(io.BytesIO(payload), relevant_loci={KNOWN})
    assert "S1" not in str(error.value)
    assert "0|1" not in str(error.value)


@pytest.mark.parametrize(
    "payload", [b"not gzip", gzip.compress(HEADER + RECORD)[:-4], gzip.compress(HEADER + RECORD)[:-8] + b"badcrc!!"]
)
def test_corrupt_or_truncated_gzip_is_rejected(payload):
    with pytest.raises(VcfValidationError, match="invalid or incomplete"):
        scan_vcf(io.BytesIO(payload), relevant_loci={KNOWN}, compressed=True)


@pytest.mark.parametrize(
    "record", [RECORD.replace(b"100", b"PRIVATE_POSITION"), RECORD.replace(b"0|1", b"PRIVATE_GENOTYPE\xff")]
)
def test_validation_tracebacks_do_not_expose_raw_decoder_or_integer_errors(record):
    with pytest.raises(VcfValidationError) as error:
        scan_vcf(io.BytesIO(HEADER + record), relevant_loci={KNOWN})
    assert "PRIVATE_" not in "".join(traceback.format_exception(error.value))


@pytest.mark.parametrize(
    ("limits", "payload", "message"),
    [
        (VcfLimits(max_line_bytes=16), HEADER + RECORD, "line size"),
        (VcfLimits(max_uncompressed_bytes=len(HEADER)), HEADER + RECORD, "decompressed size"),
        (VcfLimits(max_records=1), HEADER + RECORD * 2, "record count"),
        (
            VcfLimits(max_retained_calls=1),
            HEADER + RECORD + RECORD.replace(b"100", b"101"),
            "retained variant",
        ),
    ],
)
def test_limits_bound_scan_resources(limits, payload, message):
    with pytest.raises(VcfValidationError, match=message):
        scan_vcf(io.BytesIO(payload), relevant_loci={KNOWN, ("1", 101, "A", "G")}, limits=limits)


def test_cancellation_stops_before_next_record_and_does_not_close_caller_source():
    progress = []
    source = io.BytesIO(HEADER + RECORD * 100)
    with pytest.raises(VcfCancelled):
        scan_vcf(
            source,
            relevant_loci={KNOWN},
            on_progress=progress.append,
            cancelled=lambda: bool(progress and progress[-1].records_scanned >= 2),
            limits=VcfLimits(progress_interval_records=2),
        )
    assert source.tell() == len(HEADER) + len(RECORD) * 2
    assert not source.closed


def test_missing_reference_unsorted_records_and_no_final_newline_are_supported():
    payload = HEADER.replace(b"##reference=GRCh38\n", b"") + RECORD.replace(b"100", b"200") + RECORD.rstrip(b"\n")
    result = scan_vcf(io.BytesIO(payload), relevant_loci={KNOWN})
    assert result.calls == (Call(*KNOWN, 1, (1,)),)
    assert result.records_scanned == 2


def test_iterable_and_legacy_compressed_reader_match_existing_reader():
    text = (HEADER + RECORD).decode()
    assert list(iter_calls(iter(text.splitlines(keepends=True)))) == read_calls(text)
    assert read_calls_gz(gzip.compress(text.encode())) == read_calls(text)


def test_streaming_and_legacy_analysis_have_identical_report_and_full_scan_count(database):
    text = vcf("S1", [(1100, "1|0"), (1200, "0|1")]) + RECORD.decode()
    with db.session(database) as connection:
        analyzer = Analyzer(connection)
        scan = scan_vcf(io.BytesIO(text.encode()), relevant_loci=analyzer.variants.by_locus)
        legacy = analyzer.analyze(read_calls(text), "recurrent fever and abdominal pain", "female", use_llm=False)
        streamed = analyzer.analyze(
            list(scan.calls),
            "recurrent fever and abdominal pain",
            "female",
            use_llm=False,
            variants_checked=scan.variants_checked,
        )
    assert streamed == legacy
    assert len(scan.calls) == 2
    assert streamed["genome"]["variants_checked"] == 3


def test_analyzer_rejects_scan_total_smaller_than_retained_calls(database):
    with db.session(database) as connection:
        analyzer = Analyzer(connection)
        with pytest.raises(ValueError, match="less than retained"):
            analyzer.analyze([Call(*KNOWN, 1, ())], "", None, use_llm=False, variants_checked=0)
