import { z } from "zod";
import type { KnowledgeGraph } from "../graph/graph";
import { ingestPatient, type IngestResult } from "../graph/ingest";
import { diseaseId, variantId } from "./graph";

/**
 * The parts of the backend's analysis report (Analyzer.analyze in
 * backend/crispr_backend/analysis/pipeline.py) that place a simulated patient in the
 * graph. Unknown fields are ignored; a report missing these fields is rejected.
 */
export const BackendReportSchema = z.object({
  findings: z.array(
    z.object({
      tier: z.enum(["likely", "possible", "carrier"]),
      omim_id: z.string(),
      disease: z.string(),
      gene: z.string(),
      genotype: z.object({ status: z.enum(["affected", "carrier"]) }),
      variants: z.array(
        z.object({
          variation_id: z.number().int().positive(),
          zygosity: z.enum(["heterozygous", "homozygous", "hemizygous"]),
        }),
      ),
    }),
  ),
  symptoms: z
    .object({ terms: z.array(z.object({ id: z.string(), name: z.string() })) })
    .optional(),
});
export type BackendReport = z.infer<typeof BackendReportSchema>;

export const SimulatedPatientSchema = z.object({
  /** Our own label (sim-NNN); never a 1000 Genomes sample id. */
  patientId: z.string().regex(/^sim-\d{3,}$/),
  sex: z.enum(["F", "M"]),
  report: BackendReportSchema,
});
export type SimulatedPatient = z.infer<typeof SimulatedPatientSchema>;

const ZYGOSITY = {
  heterozygous: "het",
  homozygous: "hom",
  hemizygous: "hemi",
} as const;

/**
 * Adds one simulated patient to a ClinVar-backed graph through ingestPatient. Variants
 * link by ClinVar VariationID; findings keep the backend's tier and genotype status and
 * carry no scores, because the backend report has none to give.
 */
export function ingestSimulatedPatient(
  g: KnowledgeGraph,
  patient: SimulatedPatient,
): IngestResult {
  const { patientId, sex, report } = SimulatedPatientSchema.parse(patient);
  const variants = new Map<string, "het" | "hom" | "hemi">();
  for (const f of report.findings)
    for (const v of f.variants)
      variants.set(variantId(v.variation_id), ZYGOSITY[v.zygosity]);
  return ingestPatient(g, {
    patientId,
    sex,
    variants: [...variants].map(([variant, zygosity]) => ({
      variant,
      zygosity,
    })),
    phenotypes: (report.symptoms?.terms ?? []).map((t) => t.name),
    findings: report.findings.map((f) => ({
      disease: diseaseId(f.omim_id),
      status: f.genotype.status,
      tier: f.tier === "carrier" ? null : f.tier,
      geneticScore: null,
      phenotypeScore: null,
      combinedScore: null,
    })),
  });
}
