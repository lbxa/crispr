import {
  SEQUENCE_CHUNK,
  type GenomeChromosome,
  type GenomeSequenceSource,
} from "@crispr/human-model/dna-sequence";

/** Deliberately synthetic lengths and sequence; never represents an uploaded file. */
export const DEMO_CHROMOSOMES: readonly GenomeChromosome[] = [
  ...Array.from({ length: 22 }, (_, index) => ({
    id: String(index + 1),
    length: 248_000_000 - index * 8_000_000,
  })),
  { id: "X", length: 156_000_000 },
  { id: "Y", length: 57_000_000 },
];

export const DEMO_GENOME: GenomeSequenceSource = {
  async readRange(chromosome, start, end, signal) {
    signal.throwIfAborted();
    if (
      start < 0 ||
      end > chromosome.length ||
      end < start ||
      end - start > SEQUENCE_CHUNK * 3
    ) {
      throw new RangeError("Invalid demo sequence range");
    }
    const seed =
      Array.from(chromosome.id).reduce(
        (value, letter) => value * 31 + letter.charCodeAt(0),
        0,
      ) * 7919;
    let bases = "";
    for (let index = start; index < end; index++) {
      // Position-addressable fixture: overlapping lazy ranges always agree.
      let value = Math.imul(index ^ seed, 0x45d9f3b);
      value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
      bases += "ACGT"[(value ^ (value >>> 16)) & 3];
    }
    return bases;
  },
};
