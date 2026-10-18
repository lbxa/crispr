import { z } from "zod";

/** GRCh38 reference bases fill DNA positions an uploaded VCF says nothing about. */
export const CHROMOSOME_PATTERN = /^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT)$/;
/** Matches backend/crispr_backend/api.py MAX_REFERENCE_BASES. */
export const MAX_REFERENCE_BASES = 16_384;
/** The browser fetches aligned blocks of this size and reuses them while scrolling. */
export const REFERENCE_BLOCK = 4096;
const BLOCK_CACHE_SIZE = 256; // blocks (~1 MB of bases)
const BLOCK_TIMEOUT_MS = 15_000;

export const referenceRangeSchema = z
  .object({
    chromosome: z.string().regex(CHROMOSOME_PATTERN),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    bases: z.string().regex(/^[ACGTN]+$/),
  })
  .refine(
    ({ start, end, bases }) => end > start && bases.length === end - start,
    "Bases do not match the requested interval",
  );

export type ReferenceRange = z.infer<typeof referenceRangeSchema>;

/** Resolves reference bases for [start, end), or null when the reference is unavailable. */
export type ReferenceLoader = (
  chromosome: string,
  start: number,
  end: number,
  signal: AbortSignal,
) => Promise<string | null>;

async function fetchBlock(
  chromosome: string,
  start: number,
  end: number,
): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/reference/${encodeURIComponent(chromosome)}?start=${start}&end=${end}`,
      { signal: AbortSignal.timeout(BLOCK_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const parsed = referenceRangeSchema.safeParse(await response.json());
    return parsed.success &&
      parsed.data.chromosome === chromosome &&
      parsed.data.start === start &&
      parsed.data.end === end
      ? parsed.data.bases
      : null;
  } catch {
    return null;
  }
}

/**
 * Loads reference ranges through this app's server route in aligned blocks. Blocks are shared
 * between overlapping reads and kept in a small LRU, so scrolling rarely refetches. A block that
 * fails is forgotten and retried on the next read. Never throws except on the caller's abort.
 */
export function createReferenceLoader(
  lengths: ReadonlyMap<string, number>,
): ReferenceLoader {
  const blocks = new Map<string, Promise<string | null>>();

  function block(chromosome: string, index: number) {
    const key = `${chromosome}:${index}`;
    const cached = blocks.get(key);
    if (cached) {
      blocks.delete(key); // refresh its LRU position
      blocks.set(key, cached);
      return cached;
    }
    const length = lengths.get(chromosome) ?? 0;
    const start = index * REFERENCE_BLOCK;
    const pending = fetchBlock(
      chromosome,
      start,
      Math.min(length, start + REFERENCE_BLOCK),
    ).then((bases) => {
      if (bases === null) blocks.delete(key);
      return bases;
    });
    blocks.set(key, pending);
    if (blocks.size > BLOCK_CACHE_SIZE)
      blocks.delete(blocks.keys().next().value!);
    return pending;
  }

  return async (chromosome, start, end, signal) => {
    signal.throwIfAborted();
    const length = lengths.get(chromosome);
    if (length === undefined || start >= end || end > length) return null;
    const first = Math.floor(start / REFERENCE_BLOCK);
    const last = Math.floor((end - 1) / REFERENCE_BLOCK);
    const parts = Promise.all(
      Array.from({ length: last - first + 1 }, (_, offset) =>
        block(chromosome, first + offset),
      ),
    );
    // Shared blocks keep loading for other readers; only this read gives up on abort.
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => reject(signal.reason);
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });
    const loaded = await Promise.race([parts, aborted]);
    if (loaded.some((bases) => bases === null)) return null;
    const joined = loaded.join("");
    const offset = start - first * REFERENCE_BLOCK;
    return joined.slice(offset, offset + (end - start));
  };
}
