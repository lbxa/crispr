import { z } from "zod";
import {
  ANATOMY_REGIONS,
  findHealthResultMapping,
  type AnatomyRegionId,
} from "@crispr/human-model/anatomy";
import type { HumanModelHighlight } from "@crispr/human-model";
import type { GenomeReport } from "./contract";

const mappingSchema = z.object({
  finding_index: z.number().int().nonnegative(),
  region_ids: z
    .array(z.enum(ANATOMY_REGIONS.map(({ id }) => id)))
    .max(ANATOMY_REGIONS.length)
    .refine((ids) => new Set(ids).size === ids.length),
});

export const bodyMapSchema = z.discriminatedUnion("status", [
  z.object({
    version: z.literal(1),
    status: z.literal("mapped"),
    source: z.literal("gemini"),
    mappings: z.array(mappingSchema).max(100),
  }),
  z.object({
    version: z.literal(1),
    status: z.enum(["unavailable", "not_needed"]),
    source: z.null(),
    mappings: z.array(z.never()).max(0),
  }),
]);

export type BodyRegionHighlight = HumanModelHighlight & {
  readonly association?: "carrier";
};

/** Display associations retain carrier context; disease evidence takes precedence. */
export function bodyHighlights(
  report: GenomeReport,
): readonly BodyRegionHighlight[] {
  const associations = new Map<AnatomyRegionId, "carrier" | "disease">();
  if (report.body_map?.status === "mapped") {
    for (const mapping of report.body_map.mappings) {
      const finding = report.findings[mapping.finding_index];
      if (finding && finding.tier !== "carrier") {
        for (const id of mapping.region_ids) associations.set(id, "disease");
      }
    }
  }
  for (const finding of report.findings) {
    if (finding.gene !== "PAH") continue;
    if (report.body_map?.status === "mapped" && finding.tier !== "carrier")
      continue;
    // Reviewed display association for older reports and PKU carriers. Other
    // diseases still require a backend map; do not guess from gene names.
    const mapping = findHealthResultMapping(finding.disease);
    if (mapping?.key !== "phenylketonuria") continue;
    for (const { regionId } of mapping.regions) {
      if (associations.get(regionId) !== "disease") {
        associations.set(
          regionId,
          finding.tier === "carrier" ? "carrier" : "disease",
        );
      }
    }
  }
  return [...associations].map(([regionId, association]) => ({
    regionId,
    color: "#ef4444",
    strength: 1,
    ...(association === "carrier" ? { association } : {}),
  }));
}
