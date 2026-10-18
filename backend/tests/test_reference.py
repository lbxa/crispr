"""The .2bit reference reader and the /reference endpoint, against small generated files."""

import random
import struct

import pytest
from fastapi.testclient import TestClient

from crispr_backend import reference
from crispr_backend.api import app
from crispr_backend.reference import TwoBit

CODES = {"T": 0, "C": 1, "A": 2, "G": 3, "N": 0}


def write_two_bit(path, sequences: dict[str, str], order: str = "<") -> None:
    """Write a .2bit file. Uppercase N runs become N blocks; lowercase runs become mask blocks."""
    records = []
    for seq in sequences.values():
        n_blocks, mask_blocks = runs(seq, lambda b: b in "Nn"), runs(seq, str.islower)
        packed = bytearray()
        upper = seq.upper()
        for i in range(0, len(upper), 4):
            chunk = upper[i : i + 4].ljust(4, "T")
            packed.append(sum(CODES[b] << (6 - 2 * j) for j, b in enumerate(chunk)))
        body = struct.pack(order + "II", len(seq), len(n_blocks))
        body += struct.pack(order + f"{len(n_blocks)}I", *(s for s, _ in n_blocks))
        body += struct.pack(order + f"{len(n_blocks)}I", *(n for _, n in n_blocks))
        body += struct.pack(order + "I", len(mask_blocks))
        body += struct.pack(order + f"{len(mask_blocks)}I", *(s for s, _ in mask_blocks))
        body += struct.pack(order + f"{len(mask_blocks)}I", *(n for _, n in mask_blocks))
        body += struct.pack(order + "I", 0) + bytes(packed)
        records.append(body)
    header = struct.pack(order + "IIII", 0x1A412743, 0, len(sequences), 0)
    index_size = sum(1 + len(name) + 4 for name in sequences)
    offset = len(header) + index_size
    index = b""
    for name, body in zip(sequences, records, strict=True):
        index += bytes([len(name)]) + name.encode() + struct.pack(order + "I", offset)
        offset += len(body)
    path.write_bytes(header + index + b"".join(records))


def runs(seq: str, member) -> list[tuple[int, int]]:
    found, start = [], None
    for i, base in enumerate(seq + "\0"):
        inside = i < len(seq) and member(base)
        if inside and start is None:
            start = i
        elif not inside and start is not None:
            found.append((start, i - start))
            start = None
    return found


RNG = random.Random(7)
CHR1 = "".join(RNG.choice("ACGT") for _ in range(203))
# N runs at the start, in the middle and at the end; a soft-masked (lowercase) stretch.
CHR1 = "NNNNN" + CHR1[5:40] + CHR1[40:60].lower() + "N" * 13 + CHR1[73:190] + "N" * 13
CHR7 = "".join(RNG.choice("ACGT") for _ in range(97))


@pytest.fixture
def two_bit(tmp_path):
    path = tmp_path / "ref.2bit"
    write_two_bit(path, {"chr1": CHR1, "chr7": CHR7})
    return path


@pytest.mark.parametrize("order", ["<", ">"])
def test_reads_every_range_in_either_byte_order(tmp_path, order):
    path = tmp_path / "ref.2bit"
    write_two_bit(path, {"chr1": CHR1, "chr7": CHR7}, order)
    genome = TwoBit(path)
    assert genome.length("chr1") == len(CHR1) and genome.length("chrY") is None
    expected = CHR1.upper()
    # Every start/end pair crosses byte boundaries, N runs and the masked stretch somewhere.
    for start in range(0, len(CHR1), 3):
        for end in range(start, len(CHR1) + 1, 5):
            assert genome.sequence("chr1", start, end) == expected[start:end]
    assert genome.sequence("chr7", 0, len(CHR7)) == CHR7


def test_rejects_ranges_outside_the_chromosome_and_non_two_bit_files(two_bit, tmp_path):
    genome = TwoBit(two_bit)
    with pytest.raises(IndexError):
        genome.sequence("chr7", 90, 98)
    with pytest.raises(IndexError):
        genome.sequence("chr7", 5, 4)
    bogus = tmp_path / "bogus.2bit"
    bogus.write_bytes(b"not a 2bit file")
    with pytest.raises(ValueError):
        TwoBit(bogus)


@pytest.fixture
def client(two_bit, monkeypatch, database):
    monkeypatch.setenv("CRISPR_REFERENCE_2BIT", str(two_bit))
    reference.get_reference.cache_clear()
    with TestClient(app) as test_client:
        yield test_client
    reference.get_reference.cache_clear()


def test_endpoint_serves_reference_bases(client):
    response = client.get("/reference/7", params={"start": 10, "end": 30})
    assert response.status_code == 200
    assert response.json() == {"chromosome": "7", "start": 10, "end": 30, "bases": CHR7[10:30]}
    assert "immutable" in response.headers["cache-control"]
    assert client.get("/reference/1", params={"start": 0, "end": 8}).json()["bases"] == "NNNNN" + CHR1[5:8]


def test_endpoint_validates_requests(client):
    assert client.get("/reference/Y", params={"start": 0, "end": 5}).status_code == 404
    assert client.get("/reference/7", params={"start": 90, "end": 98}).status_code == 422
    assert client.get("/reference/7", params={"start": 5, "end": 5}).status_code == 422
    assert client.get("/reference/7", params={"start": 0, "end": 20_000}).status_code == 422
    assert client.get("/reference/chr7", params={"start": 0, "end": 5}).status_code == 422
    assert client.get("/reference/7", params={"start": -1, "end": 5}).status_code == 422


def test_endpoint_reports_a_missing_reference(monkeypatch, tmp_path, database):
    monkeypatch.setenv("CRISPR_REFERENCE_2BIT", str(tmp_path / "absent.2bit"))
    reference.get_reference.cache_clear()
    with TestClient(app) as test_client:
        assert test_client.get("/reference/7", params={"start": 0, "end": 5}).status_code == 503
    reference.get_reference.cache_clear()
