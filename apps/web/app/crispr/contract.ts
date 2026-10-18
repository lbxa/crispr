import { z } from "zod";

// Matches GET /genes/{gene}/crispr in backend/crispr_backend/api.py. Like the genome report, the
// Python response is validated before its evidence and repair templates reach the report drawer.
export const GENE_PATTERN = /^[A-Za-z0-9-]{1,24}$/;

const band = z.enum(["high", "moderate", "low", "unavailable"]);

const energySchema = z.object({
  rna_dna: z.number(),
  rna_dna_weighted: z.number(),
  dna_opening: z.number(),
  spacer_self_fold: z.number(),
  crisproff_score: z.number(),
});

const guideSchema = z.object({
  spacer: z.string().regex(/^[ACGTN]{20}$/),
  pam: z.string().regex(/^[ACGTN]{3}$/),
  strand: z.enum(["+", "-"]),
  cut_position: z.number().int(),
  cut_distance: z.number().int().nonnegative(),
  gc_content: z.number().min(0).max(1),
  allele_specific: z.boolean(),
  score: z.number(),
  notes: z.array(z.string()),
  /** The 30-nt CRISPRon input: 4 nt + 20 nt spacer + 3 nt PAM + 3 nt. Null near a region edge. */
  context: z
    .string()
    .regex(/^[ACGTN]{30}$/)
    .nullable(),
  /** Predicted indel frequency (%), or null when the scorer was unavailable. */
  efficiency: z.number().nullable(),
  /** Each ensemble member's own prediction, keyed by model name. */
  model_scores: z.record(z.string(), z.number()).nullable(),
  energy: energySchema.nullable(),
});

const advisabilitySchema = z.object({
  score: z.number().nullable(),
  band,
  label: z.string(),
  best_guide: z.string().nullable(),
  guides_scored: z.number().int().nonnegative(),
  guides_skipped: z.number().int().nonnegative(),
  basis: z.string(),
  threshold: z.number(),
  recommended: z.boolean().nullable(),
});

export const editSchema = z.object({
  variation_id: z.number().int(),
  variant: z.string().nullable(),
  disease: z.string().optional(),
  strategy: z.string(),
  rationale: z.string(),
  guides: z.array(guideSchema),
  alternative: z.string(),
  off_target: z.string(),
  advisability: advisabilitySchema.nullable(),
  repair_template: z
    .string()
    .regex(/^[ACGTN]+$/)
    .max(4 * 1024 * 1024)
    .nullable()
    .optional(),
  repair_template_notes: z.string().nullable().optional(),
});

export const overviewSchema = z.object({
  verdict: z.enum([
    "recommended",
    "not_recommended",
    "unavailable",
    "no_guide",
    "no_edit",
  ]),
  score: z.number().nullable(),
  band: band.nullable(),
  threshold: z.number(),
  gene: z.string().nullable(),
  target: z.string().nullable(),
  headline: z.string(),
  edits_considered: z.number().int().nonnegative(),
  basis: z.string(),
});

export const genePlanSchema = z.object({
  gene: z.string().min(1),
  overview: overviewSchema,
  edits: z.array(editSchema),
  disclaimer: z.string().min(1),
});

export type Energy = z.infer<typeof energySchema>;
export type Guide = z.infer<typeof guideSchema>;
export type Advisability = z.infer<typeof advisabilitySchema>;
export type Edit = z.infer<typeof editSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type GenePlan = z.infer<typeof genePlanSchema>;

export const PLAN_ERRORS = {
  invalid_gene: "That gene name isn't valid.",
  not_found: "CRISPR editing isn't available for this gene.",
  backend_unavailable:
    "The CRISPR analysis service is unavailable. Try again shortly.",
  backend_timeout: "The CRISPR analysis took too long. Try again.",
  invalid_response:
    "The CRISPR analysis service returned an incomplete result. Try again.",
  canceled: "The request was canceled.",
} as const;

export type PlanErrorCode = keyof typeof PLAN_ERRORS;

export const planResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plan: genePlanSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(
        Object.keys(PLAN_ERRORS) as [PlanErrorCode, ...PlanErrorCode[]],
      ),
      message: z.string().min(1),
    }),
  }),
]);

export type PlanResult = z.infer<typeof planResultSchema>;

export function planFailure(
  code: PlanErrorCode,
): Extract<PlanResult, { ok: false }> {
  return { ok: false, error: { code, message: PLAN_ERRORS[code] } };
}
