import { z } from "zod";
import {
  SEQUENCE_CHUNK,
  type GenomeSequenceSource,
} from "@crispr/human-model/dna-sequence";
import type { ReferenceLoader } from "./reference";

const coordinate = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const chromosomeId = z.string().regex(/^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT)$/);
const allele = z
  .string()
  .min(1)
  .max(4 * 1024 * 1024)
  .regex(/^[ACGTN]+$/);
const regionSchema = z
  .object({
    id: z.string().min(1).max(200),
    chromosome: chromosomeId,
    start: coordinate,
    end: coordinate,
    reference: allele,
    alternate: allele,
    clinical_significance: z.string().min(1),
    zygosity: z.enum(["heterozygous", "homozygous", "hemizygous"]),
    annotations: z
      .array(
        z.object({
          gene: z.string().min(1),
          disease: z.string().min(1),
          tier: z.enum(["likely", "possible", "carrier"]),
        }),
      )
      .min(1),
    reference_context: z
      .object({
        start: coordinate,
        end: coordinate,
        bases: z
          .string()
          .min(1)
          .max(1536)
          .regex(/^[ACGTN]+$/),
      })
      .nullable(),
  })
  .refine((region) => {
    if (region.end - region.start !== region.reference.length) return false;
    const context = region.reference_context;
    return (
      !context ||
      (context.start <= region.start &&
        context.end >= region.end &&
        context.end - context.start === context.bases.length &&
        context.bases.slice(
          region.start - context.start,
          region.end - context.start,
        ) === region.reference)
    );
  }, "Invalid reference interval or context");

/** Versioned BED-compatible coordinates; malformed maps never reach the renderer. */
export const genomeViewSchema = z
  .object({
    version: z.literal(1),
    assembly: z.literal("GRCh38"),
    coordinate_system: z.literal("zero-based-half-open"),
    chromosomes: z
      .array(z.object({ id: chromosomeId, length: coordinate.positive() }))
      .min(1)
      .max(25),
    regions: z.array(regionSchema).max(100_000),
  })
  .refine((view) => {
    const lengths = new Map(
      view.chromosomes.map((chromosome) => [chromosome.id, chromosome.length]),
    );
    const ids = new Set<string>();
    return (
      lengths.size === view.chromosomes.length &&
      view.regions.every((region) => {
        const length = lengths.get(region.chromosome);
        if (
          !length ||
          region.end > length ||
          (region.reference_context?.end ?? 0) > length ||
          ids.has(region.id)
        )
          return false;
        ids.add(region.id);
        return true;
      })
    );
  }, "Region is outside its chromosome or has a duplicate identity");

export type GenomeView = z.infer<typeof genomeViewSchema>;
export type GenomeRegion = GenomeView["regions"][number];

/**
 * VCFs are variant lists, not DNA. Backend-provided reference contexts around findings
 * always win; with `loadReference`, every other position shows the GRCh38 reference, and
 * without it (or if the reference is unavailable) those positions stay N.
 */
export function referenceSequenceSource(
  view: GenomeView,
  loadReference?: ReferenceLoader,
  onReferenceAvailability?: (available: boolean) => void,
): GenomeSequenceSource {
  return {
    async readRange(chromosome, start, end, signal) {
      signal.throwIfAborted();
      const known = view.chromosomes.find(({ id }) => id === chromosome.id);
      if (
        !known ||
        known.length !== chromosome.length ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > known.length ||
        end < start ||
        end - start > SEQUENCE_CHUNK * 3
      )
        throw new RangeError("Invalid reference sequence range");
      const reference =
        loadReference && end > start
          ? await loadReference(chromosome.id, start, end, signal)
          : null;
      signal.throwIfAborted();
      if (loadReference && end > start)
        onReferenceAvailability?.(reference !== null);
      const bases = new Array<string>(end - start).fill("N");
      for (const region of view.regions) {
        const context = region.reference_context;
        if (region.chromosome !== chromosome.id || !context) continue;
        for (
          let index = Math.max(start, context.start);
          index < Math.min(end, context.end);
          index++
        ) {
          const base = context.bases[index - context.start]!;
          const previous = bases[index - start];
          if (base === "N") continue;
          if (previous !== "N" && previous !== base)
            throw new Error("Conflicting reference contexts");
          bases[index - start] = base;
        }
      }
      // Positions no context covers fall back to the reference (or stay N without one).
      return reference
        ? bases
            .map((base, index) => (base === "N" ? reference[index]! : base))
            .join("")
        : bases.join("");
    },
  };
}
