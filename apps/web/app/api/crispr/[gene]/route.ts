import { getLogger, withContext } from "@crispr/observability";
import { fetchGenePlan } from "../../../crispr/backend";
import {
  GENE_PATTERN,
  planFailure,
  type PlanResult,
} from "../../../crispr/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gene: string }> },
): Promise<Response> {
  const { gene } = await params;
  const requestId = crypto.randomUUID();
  return withContext(
    { request_id: requestId, workflow: "crispr_plan" },
    async () => {
      const logger = getLogger("crispr-plan");
      const started = performance.now();

      function respond(result: PlanResult, status: number) {
        const fields = {
          gene,
          duration_ms: Math.round(performance.now() - started),
          outcome: result.ok ? "completed" : "failed",
          ...(!result.ok ? { error_code: result.error.code } : {}),
        };
        if (result.ok) logger.info(fields, "crispr_plan_completed");
        else logger.warn(fields, "crispr_plan_failed");
        return Response.json(result, {
          status,
          headers: {
            "Cache-Control": "private, no-store",
            "X-Request-Id": requestId,
          },
        });
      }

      if (!GENE_PATTERN.test(gene))
        return respond(planFailure("invalid_gene"), 400);
      const result = await fetchGenePlan({
        gene,
        signal: request.signal,
        requestId,
      });
      if (result.ok) return respond(result, 200);
      const status = {
        invalid_gene: 400,
        not_found: 404,
        backend_unavailable: 503,
        backend_timeout: 504,
        invalid_response: 502,
        canceled: 499,
      }[result.error.code];
      return respond(result, status);
    },
  );
}
