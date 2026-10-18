import "server-only";

import { DEFAULT_BACKEND_URL } from "../genome-analysis/backend";
import {
  GENE_PATTERN,
  genePlanSchema,
  planFailure,
  type PlanResult,
} from "./contract";

const PLAN_TIMEOUT_MS = 45_000;

/**
 * Where CRISPR plans come from. Defaults to the genome backend; CRISPR_PLAN_API_URL points it
 * elsewhere, e.g. while the scoring service is only running on a developer machine.
 */
export function planBackendUrl(): string {
  return (
    process.env.CRISPR_PLAN_API_URL ??
    process.env.CRISPR_API_URL ??
    DEFAULT_BACKEND_URL
  );
}

/** The only server-side adapter to Python's gene-by-name CRISPR endpoint. */
export async function fetchGenePlan({
  gene,
  signal,
  requestId,
}: {
  gene: string;
  signal: AbortSignal;
  requestId: string;
}): Promise<PlanResult> {
  if (!GENE_PATTERN.test(gene)) return planFailure("invalid_gene");
  const timeout = AbortSignal.timeout(PLAN_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      new URL(`/genes/${encodeURIComponent(gene)}/crispr`, planBackendUrl()),
      {
        headers: { "X-Request-Id": requestId },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([signal, timeout]),
      },
    );
  } catch {
    return planFailure(
      signal.aborted
        ? "canceled"
        : timeout.aborted
          ? "backend_timeout"
          : "backend_unavailable",
    );
  }
  if (!response.ok)
    return planFailure(
      response.status === 404 ? "not_found" : "backend_unavailable",
    );
  try {
    const plan = genePlanSchema.safeParse(await response.json());
    return plan.success
      ? { ok: true, plan: plan.data }
      : planFailure("invalid_response");
  } catch {
    return planFailure(
      signal.aborted
        ? "canceled"
        : timeout.aborted
          ? "backend_timeout"
          : "invalid_response",
    );
  }
}
