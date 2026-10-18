"""GRCh38 reference sequence from a UCSC .2bit file, read by random access.

The file (hg38.2bit, ~800 MB) holds the whole genome at 2 bits per base. Only the
bytes for a requested range are read, so a lookup is a few small `pread`s whatever
the chromosome. Pure Python and byte-order aware, so it runs unchanged on s390x.
Format: https://genome.ucsc.edu/FAQ/FAQformat.html#format7
"""

import os
import struct
from bisect import bisect_right
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from crispr_backend.db import BACKEND_ROOT

SIGNATURE = 0x1A412743
BASES = "TCAG"  # 2-bit codes 00, 01, 10, 11
# Every byte decodes to four bases, most significant pair first.
BYTE_TO_BASES = ["".join(BASES[(byte >> shift) & 3] for shift in (6, 4, 2, 0)) for byte in range(256)]
DEFAULT_PATH = BACKEND_ROOT / "data" / "reference" / "hg38.2bit"


def two_bit_name(chromosome: str) -> str:
    """App chromosome id ("1".."22", "X", "Y", "MT") -> UCSC sequence name."""
    return "chrM" if chromosome == "MT" else f"chr{chromosome}"


@dataclass(frozen=True)
class _Record:
    length: int
    n_starts: tuple[int, ...]  # runs of unknown bases (N), sorted
    n_ends: tuple[int, ...]
    dna_offset: int


class TwoBit:
    def __init__(self, path: Path):
        self.path = path
        self._fd = os.open(path, os.O_RDONLY)
        signature = int.from_bytes(self._read(0, 4), "little")
        if signature == SIGNATURE:
            self._order = "<"
        elif int.from_bytes(self._read(0, 4), "big") == SIGNATURE:
            self._order = ">"
        else:
            raise ValueError(f"{path} is not a .2bit file")
        version, count, _reserved = self._unpack(4, "III")
        offset_format = "Q" if version == 1 else "I"  # version 1 allows files over 4 GB
        self._offsets: dict[str, int] = {}
        position = 16
        for _ in range(count):
            (name_size,) = self._read(position, 1)
            name = self._read(position + 1, name_size).decode()
            position += 1 + name_size
            (self._offsets[name],) = self._unpack(position, offset_format)
            position += struct.calcsize(offset_format)
        self._records: dict[str, _Record] = {}

    def _read(self, offset: int, size: int) -> bytes:
        data = os.pread(self._fd, size, offset)  # positional read: safe across threads
        if len(data) != size:
            raise ValueError(f"{self.path} is truncated")
        return data

    def _unpack(self, offset: int, fields: str) -> tuple:
        layout = self._order + fields
        return struct.unpack(layout, self._read(offset, struct.calcsize(layout)))

    def _record(self, name: str) -> _Record:
        if name not in self._records:
            position = self._offsets[name]
            length, n_count = self._unpack(position, "II")
            position += 8
            n_starts = self._unpack(position, f"{n_count}I")
            n_sizes = self._unpack(position + 4 * n_count, f"{n_count}I")
            position += 8 * n_count
            (mask_count,) = self._unpack(position, "I")
            # Skip the soft-mask (lowercase) blocks and the reserved word.
            position += 4 + 8 * mask_count + 4
            self._records[name] = _Record(
                length=length,
                n_starts=n_starts,
                n_ends=tuple(start + size for start, size in zip(n_starts, n_sizes, strict=True)),
                dna_offset=position,
            )
        return self._records[name]

    def length(self, name: str) -> int | None:
        return self._record(name).length if name in self._offsets else None

    def sequence(self, name: str, start: int, end: int) -> str:
        """Uppercase bases of [start, end), zero-based, with unknown positions as N."""
        record = self._record(name)
        if not 0 <= start <= end <= record.length:
            raise IndexError(f"{name}:{start}-{end} is outside 0-{record.length}")
        if start == end:
            return ""
        first, last = start // 4, (end - 1) // 4
        packed = self._read(record.dna_offset + first, last - first + 1)
        decoded = "".join(BYTE_TO_BASES[byte] for byte in packed)
        bases = list(decoded[start - first * 4 : end - first * 4])
        # Overlay N runs that intersect the range (binary search, then walk forward).
        index = max(0, bisect_right(record.n_starts, start) - 1)
        while index < len(record.n_starts) and record.n_starts[index] < end:
            low, high = max(start, record.n_starts[index]), min(end, record.n_ends[index])
            if low < high:
                bases[low - start : high - start] = "N" * (high - low)
            index += 1
        return "".join(bases)


@cache
def get_reference() -> TwoBit | None:
    """The GRCh38 reference, or None when the file is not installed (e.g. on a laptop)."""
    path = Path(os.environ.get("CRISPR_REFERENCE_2BIT", DEFAULT_PATH))
    return TwoBit(path) if path.is_file() else None
