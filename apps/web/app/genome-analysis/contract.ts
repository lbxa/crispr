import { z } from "zod";
import { genomeViewSchema } from "./genome-view";
import { bodyMapSchema } from "./body-map";
import { editSchema, genePlanSchema, overviewSchema } from "../crispr/contract";

// Matches backend/crispr_backend/api.py. Only uncompressed single-sample VCFs.
export const MAX_GENOME_BYTES = 20 * 1024 * 1024;
// Large files bypass the compatibility /api/analyze route entirely.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

// Retain validated report evidence and editing results for the report drawer.
// Optional additions preserve completed reports cached by older app versions.
export const genomeReportSchema = z
  .object({
    genome_view: genomeViewSchema.optional(),
    body_map: bodyMapSchema.optional(),
    conclusion: z.object({
      status: z.enum([
        "likely_genetic_cause",
        "genetic_finding",
        "carrier_only",
        "no_finding",
      ]),
      label: z.string().min(1),
    }),
    summary: z.object({ text: z.string().min(1) }),
    overview: overviewSchema.optional(),
    gene_plans: z.array(genePlanSchema).optional(),
    genome: z.object({
      variants_checked: z.number().int().nonnegative(),
      panel_genes: z.array(z.string().min(1)),
      model_profile: z.enum(["male", "female"]).nullable().optional(),
    }),
    findings: z.array(
      z.object({
        tier: z.enum(["likely", "possible", "carrier"]),
        gene: z.string().min(1),
        disease: z.string().min(1),
        omim_id: z.string().optional(),
        inheritance: z.enum(["AD", "AR", "XLR", "XLD"]).optional(),
        genotype: z
          .object({
            status: z.enum(["affected", "carrier"]),
            explanation: z.string(),
          })
          .optional(),
        variants: z
          .array(
            z.object({
              variation_id: z.number().int().positive(),
              name: z.string().nullable(),
              rsid: z.string().nullable(),
              chrom: z.string().min(1),
              pos: z.number().int().positive(),
              ref: z.string().min(1),
              alt: z.string().min(1),
              significance: z.string(),
              stars: z.number().int().min(0).max(4),
              zygosity: z.string(),
              haplotypes: z.array(z.number().int().nonnegative()),
            }),
          )
          .optional(),
        phenotype: z
          .object({
            score: z.number(),
            rank: z.number().int().positive(),
            matched_terms: z.array(
              z.object({
                patient_term: z.string(),
                disease_term: z.string(),
                hpo_id: z.string(),
              }),
            ),
          })
          .nullable()
          .optional(),
        crispr: z.array(editSchema).optional(),
      }),
    ),
    disclaimer: z.string().min(1),
    symptoms: z
      .object({
        text: z.string().nullable(),
        extraction: z.string(),
        terms: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            matched_text: z.string(),
          }),
        ),
        closest_panel_diseases: z.array(
          z.object({
            omim_id: z.string(),
            disease: z.string(),
            score: z.number(),
          }),
        ),
      })
      .optional(),
    // Symptoms the backend predicts from the genome. The backend does not send any yet; an absent or
    // empty list means none were predicted.
    predicted_symptoms: z
      .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
      .optional(),
  })
  .refine(
    (report) => {
      const bodyMap = report.body_map;
      if (!bodyMap) return true; // Completed reports from older backend versions.
      const eligible = report.findings.flatMap((finding, index) =>
        finding.tier === "carrier" ? [] : [index],
      );
      if (bodyMap.status === "not_needed") return eligible.length === 0;
      if (bodyMap.status !== "mapped") return true;
      const indices = bodyMap.mappings.map(
        ({ finding_index }) => finding_index,
      );
      return (
        indices.length === eligible.length &&
        new Set(indices).size === indices.length &&
        indices.every((index) => eligible.includes(index))
      );
    },
    { message: "Body mapping must refer to exactly the non-carrier findings" },
  );

export type GenomeReport = z.infer<typeof genomeReportSchema>;

export const ANALYSIS_ERRORS = {
  invalid_file: "Choose one non-empty, uncompressed .vcf file.",
  too_large: "Choose a VCF file up to 20 MB.",
  invalid_vcf:
    "The genome could not be read. Choose a valid single-sample VCF on GRCh38.",
  backend_busy: "The analysis service is busy. Try again in a moment.",
  backend_unavailable:
    "The analysis service is unavailable. Try again shortly.",
  backend_timeout: "Analysis took too long. Try again.",
  invalid_response:
    "The analysis service returned an incomplete report. Try again.",
  canceled: "Analysis was canceled.",
} as const;

export type AnalysisErrorCode = keyof typeof ANALYSIS_ERRORS;

export const analysisResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), report: genomeReportSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(
        Object.keys(ANALYSIS_ERRORS) as [
          AnalysisErrorCode,
          ...AnalysisErrorCode[],
        ],
      ),
      message: z.string().min(1),
    }),
  }),
]);

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export function analysisFailure(
  code: AnalysisErrorCode,
): Extract<AnalysisResult, { ok: false }> {
  return { ok: false, error: { code, message: ANALYSIS_ERRORS[code] } };
}

export const uploadConfigSchema = z.object({
  api_url: z.url(),
  max_upload_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  chunk_size: z.number().int().positive().max(UPLOAD_CHUNK_BYTES),
});

export const uploadSessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  token: z.string().min(20).max(1024),
  upload_endpoint: z.url(),
  chunk_size: z.number().int().positive().max(UPLOAD_CHUNK_BYTES),
  max_upload_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  status: z.literal("uploading"),
  expires_at: z.string().min(1),
});

export const uploadJobSchema = z.object({
  id: uploadSessionSchema.shape.id,
  status: z.enum([
    "uploading",
    "queued",
    "processing",
    "complete",
    "failed",
    "canceled",
    "expired",
  ]),
  size_bytes: z.number().int().nonnegative(),
  uploaded_bytes: z.number().int().nonnegative(),
  records_scanned: z.number().int().nonnegative(),
  variants_checked: z.number().int().nonnegative(),
  retained_variants: z.number().int().nonnegative(),
  uncompressed_bytes: z.number().int().nonnegative(),
  report: genomeReportSchema.nullable(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1).max(500),
      retryable: z.boolean(),
    })
    .nullable(),
});

export type UploadConfig = z.infer<typeof uploadConfigSchema>;
export type UploadSession = z.infer<typeof uploadSessionSchema>;
export type UploadJob = z.infer<typeof uploadJobSchema>;

export const UPLOAD_ERRORS = {
  invalid_file: "Choose one non-empty .vcf or .vcf.gz file.",
  too_large: "Choose a genome file up to 10 GiB.",
  backend_unavailable: "The upload service is unavailable. Try again shortly.",
  invalid_response:
    "The upload service returned an invalid response. Try again.",
  upload_failed:
    "The upload was interrupted. Resume to continue from the last saved chunk.",
  upload_setup_failed:
    "Upload setup was interrupted. Start again with a fresh upload session.",
  processing_failed: "Genome processing failed. Try again.",
  session_expired: "This upload has expired. Upload the file again.",
  canceled: "Upload canceled.",
} as const;

export type GenomeUploadError = {
  code: keyof typeof UPLOAD_ERRORS;
  message: string;
  retryable: boolean;
};

export const genomeProgressSchema = uploadJobSchema.pick({
  records_scanned: true,
  variants_checked: true,
  retained_variants: true,
  uncompressed_bytes: true,
});
export type GenomeProgress = z.infer<typeof genomeProgressSchema>;
export type GenomeFileInfo = Readonly<
  Pick<File, "name" | "size" | "type" | "lastModified">
>;

export type GenomeAnalysisState =
  | { status: "idle" }
  | {
      status: "uploading";
      file: File;
      uploaded: number;
      stage: "preparing" | "transferring" | "finishing";
    }
  | { status: "paused"; file: File; uploaded: number }
  | { status: "queued" | "processing"; file: File; progress: GenomeProgress }
  | {
      status: "complete";
      file: GenomeFileInfo;
      report: GenomeReport;
      progress: GenomeProgress;
    }
  | { status: "error"; file: File; error: GenomeUploadError }
  | { status: "canceled"; file: File };

export function formatGenomeBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bytes / 1000 ** exponent)} ${units[exponent - 1]}`;
}
