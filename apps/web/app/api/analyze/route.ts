import { getLogger, withContext } from "@crispr/observability";
import { analyzeGenome } from "../../genome-analysis/backend";
import {
  analysisFailure,
  MAX_GENOME_BYTES,
  type AnalysisResult,
} from "../../genome-analysis/contract";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  return withContext(
    { request_id: requestId, workflow: "genome_analysis" },
    async () => {
      const logger = getLogger("genome-analysis");
      const started = performance.now();
      logger.info({}, "genome_analysis_started");

      function respond(result: AnalysisResult, status: number) {
        const fields = {
          duration_ms: Math.round(performance.now() - started),
          outcome: result.ok ? "completed" : "failed",
          ...(!result.ok ? { error_code: result.error.code } : {}),
        };
        if (result.ok) logger.info(fields, "genome_analysis_completed");
        else logger.warn(fields, "genome_analysis_failed");
        return Response.json(result, {
          status,
          headers: {
            "Cache-Control": "private, no-store",
            "X-Request-Id": requestId,
          },
        });
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return respond(
          analysisFailure(request.signal.aborted ? "canceled" : "invalid_file"),
          request.signal.aborted ? 499 : 400,
        );
      }
      const files = form.getAll("genome");
      const file = files[0];
      if (
        files.length !== 1 ||
        !(file instanceof File) ||
        !file.name.toLowerCase().endsWith(".vcf") ||
        file.size === 0
      ) {
        return respond(analysisFailure("invalid_file"), 400);
      }
      if (file.size > MAX_GENOME_BYTES)
        return respond(analysisFailure("too_large"), 413);

      let vcf: string;
      try {
        vcf = await file.text();
      } catch {
        return respond(analysisFailure("invalid_file"), 400);
      }
      const result = await analyzeGenome({
        vcf,
        signal: request.signal,
        requestId,
      });
      if (result.ok) return respond(result, 200);
      const status = {
        invalid_file: 400,
        too_large: 413,
        invalid_vcf: 422,
        backend_busy: 429,
        backend_unavailable: 503,
        backend_timeout: 504,
        invalid_response: 502,
        canceled: 499,
      }[result.error.code];
      return respond(result, status);
    },
  );
}
