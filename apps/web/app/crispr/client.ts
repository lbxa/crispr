import { planFailure, planResultSchema, type PlanResult } from "./contract";

/** Fetches one gene's CRISPR plan through this app's server route. Never throws. */
export async function loadGenePlan(
  gene: string,
  signal: AbortSignal,
): Promise<PlanResult> {
  let response: Response;
  try {
    response = await fetch(`/api/crispr/${encodeURIComponent(gene)}`, {
      signal,
    });
  } catch {
    return planFailure(signal.aborted ? "canceled" : "backend_unavailable");
  }
  try {
    const parsed = planResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : planFailure("invalid_response");
  } catch {
    return planFailure(signal.aborted ? "canceled" : "invalid_response");
  }
}
