/** Coordinates at this boundary are zero-based, with an exclusive end. */
export interface GenomeChromosome {
  readonly id: string;
  readonly length: number;
}

export interface GenomeSequenceSource {
  readRange(
    chromosome: GenomeChromosome,
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<string>;
}

/** Reference coordinates, including the anchor base for VCF indels. */
export interface DnaInterval {
  readonly start: number;
  readonly end: number;
}

export const DNA_FINDING_COLOR = "#f48388";

export const DNA_BASES = {
  A: { complement: "T", color: "#43d9b3" },
  T: { complement: "A", color: "#57b5f8" },
  C: { complement: "G", color: "#efbc55" },
  G: { complement: "C", color: "#b68af2" },
  N: { complement: "N", color: "#697671" },
} as const;
export type DnaBase = keyof typeof DNA_BASES;
export type DnaViewMode = "helix" | "ladder";

export interface SequenceWindow {
  readonly start: number;
  readonly bases: string;
}

export const BASE_PIXELS = 20;
const SCROLL_BASES = 4096;
export const SEQUENCE_CHUNK = 512;

export function clampGenomePosition(position: number, length: number): number {
  return Math.min(
    length - 1,
    Math.max(0, Number.isFinite(position) ? position : 0),
  );
}

/** A bounded native scroll runway avoids browser limits on billion-pixel DOMs. */
export function genomeScrollWindow(position: number, length: number) {
  const span = Math.min(SCROLL_BASES, length - 1);
  const start = Math.max(
    0,
    Math.min(length - 1 - span, Math.floor(position) - span / 2),
  );
  return { start, span, offset: (position - start) * BASE_PIXELS };
}

export function genomeSequenceRange(chunk: number, length: number) {
  return {
    start: Math.max(0, (chunk - 1) * SEQUENCE_CHUNK),
    end: Math.min(length, (chunk + 2) * SEQUENCE_CHUNK),
  };
}

export function validateSequenceWindow(
  bases: string,
  start: number,
  end: number,
): SequenceWindow {
  if (bases.length !== end - start || /[^ACGTN]/.test(bases)) {
    throw new Error("Invalid sequence range");
  }
  return { start, bases };
}
