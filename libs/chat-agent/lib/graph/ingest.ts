import { z } from "zod";
import { KnowledgeGraph, normalize } from "./graph";
import { makeEdge, makeNode, type NodeType, type Provenance } from "./types";
import { writeFindings } from "./scoring";

/**
 * Adapter between your pipeline's per-patient output and the graph.
 *
 * `variants`, `phenotypes` and `findings[].disease` are free references: a node id,
 * an rsID, an HGVS string, an HPO id or a label. They are resolved through the same
 * alias index the chat linker uses, and anything that does not resolve is reported
 * in `unresolved` instead of being silently dropped.
 *
 * If `findings` is present its scores are stored verbatim with scoring: 'pipeline'.
 * Otherwise the reference scorer fills HAS_FINDING edges.
 */
export const PatientFindingSchema = z.object({
  patientId: z.string().min(1).max(64),
  sex: z.enum(["F", "M"]),
  aliases: z.array(z.string()).optional(),
  variants: z.array(
    z.object({
      variant: z.string().min(1),
      zygosity: z.enum(["het", "hom", "hemi"]),
      genotypeQuality: z.number().optional(),
    }),
  ),
  phenotypes: z.array(z.string()),
  findings: z
    .array(
      z.object({
        disease: z.string(),
        status: z.enum(["affected", "carrier", "unlikely"]),
        tier: z.enum(["likely", "possible"]).nullable(),
        geneticScore: z.number().min(0).max(1),
        phenotypeScore: z.number().min(0).max(1),
        combinedScore: z.number().min(0).max(1),
      }),
    )
    .optional(),
});
export type PatientFinding = z.infer<typeof PatientFindingSchema>;

export function resolveRef(
  g: KnowledgeGraph,
  ref: string,
  type: NodeType,
): string | undefined {
  const direct = g.node(ref);
  if (direct && direct.type === type) return direct.id;
  for (const id of g.lookupAlias(normalize(ref))) {
    if (g.node(id)?.type === type) return id;
  }
  return undefined;
}

export interface IngestResult {
  patientNodeId: string;
  unresolved: { variants: string[]; phenotypes: string[]; diseases: string[] };
}

export function ingestPatient(
  g: KnowledgeGraph,
  raw: PatientFinding,
  prov: Provenance = "pipeline",
): IngestResult {
  const input = PatientFindingSchema.parse(raw);
  const pid = `pt:${input.patientId}`;
  g.addNode(
    makeNode(
      "Patient",
      pid,
      `Patient ${input.patientId}`,
      { sex: input.sex, simulated: true },
      {
        prov,
        aliases: [
          input.patientId,
          `patient ${input.patientId}`,
          ...(input.aliases ?? []),
        ],
      },
    ),
  );

  const unresolved: IngestResult["unresolved"] = {
    variants: [],
    phenotypes: [],
    diseases: [],
  };

  for (const v of input.variants) {
    const vid = resolveRef(g, v.variant, "Variant");
    if (!vid) {
      unresolved.variants.push(v.variant);
      continue;
    }
    g.addEdge(
      makeEdge(
        "HAS_VARIANT",
        pid,
        vid,
        { zygosity: v.zygosity, genotypeQuality: v.genotypeQuality },
        prov,
      ),
    );
  }
  for (const p of input.phenotypes) {
    const hid = resolveRef(g, p, "Phenotype");
    if (!hid) {
      unresolved.phenotypes.push(p);
      continue;
    }
    g.addEdge(makeEdge("REPORTS", pid, hid, {}, prov));
  }

  if (input.findings) {
    for (const f of input.findings) {
      const did = resolveRef(g, f.disease, "Disease");
      if (!did) {
        unresolved.diseases.push(f.disease);
        continue;
      }
      g.addEdge(
        makeEdge(
          "HAS_FINDING",
          pid,
          did,
          {
            status: f.status,
            tier: f.tier,
            geneticScore: f.geneticScore,
            phenotypeScore: f.phenotypeScore,
            combinedScore: f.combinedScore,
            scoring: "pipeline",
          },
          "pipeline",
        ),
      );
    }
  } else {
    writeFindings(g, pid);
  }
  return { patientNodeId: pid, unresolved };
}
