import "server-only";

import {
  analysisFailure,
  genomeReportSchema,
  type AnalysisResult,
} from "./contract";

export const DEFAULT_BACKEND_URL = "https://148-100-79-183.sslip.io";
const ANALYSIS_TIMEOUT_MS = 60_000;

/** The only server-side adapter to Python's genome-only analysis endpoint. */
export async function analyzeGenome({
  vcf,
  signal,
  requestId,
}: {
  vcf: string;
  signal: AbortSignal;
  requestId: string;
}): Promise<AnalysisResult> {
  const timeout = AbortSignal.timeout(ANALYSIS_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      new URL("/analyze", process.env.CRISPR_API_URL ?? DEFAULT_BACKEND_URL),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ vcf, symptoms: "", use_llm: false }),
        cache: "no-store",
        // Workers rejects redirect: "error" outright. "manual" hands back the 3xx itself, which is not
        // ok, so a redirecting backend is still treated as a failure rather than followed.
        redirect: "manual",
        signal: AbortSignal.any([signal, timeout]),
      },
    );
  } catch {
    return analysisFailure(
      signal.aborted
        ? "canceled"
        : timeout.aborted
          ? "backend_timeout"
          : "backend_unavailable",
    );
  }

  if (!response.ok) {
    return analysisFailure(
      response.status === 422
        ? "invalid_vcf"
        : response.status === 429
          ? "backend_busy"
          : "backend_unavailable",
    );
  }
  try {
    const report = genomeReportSchema.safeParse(await response.json());
    return report.success
      ? { ok: true, report: report.data }
      : analysisFailure("invalid_response");
  } catch {
    return analysisFailure(
      signal.aborted
        ? "canceled"
        : timeout.aborted
          ? "backend_timeout"
          : "invalid_response",
    );
  }
}
