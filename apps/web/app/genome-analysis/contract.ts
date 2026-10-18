import { z } from "zod";
import { genomeViewSchema } from "./genome-view";

// Matches backend/crispr_backend/api.py. Only uncompressed single-sample VCFs.
export const MAX_GENOME_BYTES = 20 * 1024 * 1024;
// Large files bypass the compatibility /api/analyze route entirely.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

// Project the Python report to the fields this UI uses. Raw variants and edit
// sequences remain at the backend boundary rather than traveling to the browser.
export const genomeReportSchema = z.object({
  genome_view: genomeViewSchema.optional(),
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
    }),
  ),
  disclaimer: z.string().min(1),
});

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
