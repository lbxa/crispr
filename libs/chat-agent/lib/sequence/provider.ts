import type { VariantLocus } from "../graph/types";

/**
 * A sequence window around a variant, expressed for the PATIENT's allele
 * (the alternate allele sits at [variantStart, variantEnd)). Guides are designed
 * against this sequence, because that is the DNA an editor would actually meet.
 */
export interface SequenceWindow {
  sequence: string;
  /** Half-open range of the variant in window coordinates. Empty (start === end) for a pure deletion. */
  variantStart: number;
  variantEnd: number;
  /** 1-based forward-strand genomic position of sequence[0], for labelling only. */
  windowStartPos: number;
  source: "synthetic" | "ensembl-GRCh38";
  /** Whether the stored reference allele matched the real reference sequence. */
  refCheck: "match" | "mismatch" | "unchecked";
  note?: string;
}

export interface SequenceProvider {
  window(locus: VariantLocus, flank?: number): Promise<SequenceWindow>;
}

export const DEFAULT_FLANK = 60;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic pseudo-random flanks. NOT real genome sequence. It exists so the
 * geometry (PAM scan, cut sites, base-editor windows) can run offline, and every
 * payload built from it says source: 'synthetic'.
 */
export class SyntheticSequenceProvider implements SequenceProvider {
  async window(
    locus: VariantLocus,
    flank = DEFAULT_FLANK,
  ): Promise<SequenceWindow> {
    const rand = mulberry32(hash(`${locus.chrom}:${locus.pos}`));
    const base = () => "ACGT"[Math.floor(rand() * 4)]!;
    const left = Array.from({ length: flank }, base).join("");
    const right = Array.from({ length: flank }, base).join("");
    return {
      sequence: left + locus.alt + right,
      variantStart: flank,
      variantEnd: flank + locus.alt.length,
      windowStartPos: locus.pos - flank,
      source: "synthetic",
      refCheck: "unchecked",
      note: "Synthetic placeholder sequence, not the real genome.",
    };
  }
}

export interface EnsemblOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  fallback?: SequenceProvider;
}

/**
 * Real GRCh38 sequence from the Ensembl REST API, with a reference-allele check.
 * `refCheck: 'mismatch'` means the stored coordinates or alleles are wrong, which is
 * the quickest way to validate the seed data once the network is reachable.
 * Falls back to the synthetic provider on any failure, and says so in `note`.
 *
 * NOTE: written against the documented endpoint shape and exercised with a mocked
 * fetch only. It has not been run against the live service.
 */
export class EnsemblSequenceProvider implements SequenceProvider {
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private timeoutMs: number;
  private fallback: SequenceProvider;

  constructor(opts: EnsemblOptions = {}) {
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://rest.ensembl.org";
    this.timeoutMs = opts.timeoutMs ?? 6000;
    this.fallback = opts.fallback ?? new SyntheticSequenceProvider();
  }

  async window(
    locus: VariantLocus,
    flank = DEFAULT_FLANK,
  ): Promise<SequenceWindow> {
    const start = locus.pos - flank;
    const end = locus.pos + locus.ref.length - 1 + flank;
    const url = `${this.baseUrl}/sequence/region/human/${encodeURIComponent(locus.chrom)}:${start}..${end}:1?content-type=application/json`;
    try {
      const res = await this.fetchFn(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`Ensembl HTTP ${res.status}`);
      const body = (await res.json()) as { seq?: unknown };
      const seq = typeof body.seq === "string" ? body.seq.toUpperCase() : "";
      if (!/^[ACGTN]+$/.test(seq) || seq.length !== end - start + 1) {
        throw new Error("Ensembl returned an unexpected sequence");
      }
      const left = seq.slice(0, flank);
      const refSeq = seq.slice(flank, flank + locus.ref.length);
      const right = seq.slice(flank + locus.ref.length);
      return {
        sequence: left + locus.alt + right,
        variantStart: flank,
        variantEnd: flank + locus.alt.length,
        windowStartPos: start,
        source: "ensembl-GRCh38",
        refCheck: refSeq === locus.ref.toUpperCase() ? "match" : "mismatch",
      };
    } catch (err) {
      const w = await this.fallback.window(locus, flank);
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ...w,
        note: `Ensembl lookup failed (${reason}); using synthetic sequence.`,
      };
    }
  }
}
