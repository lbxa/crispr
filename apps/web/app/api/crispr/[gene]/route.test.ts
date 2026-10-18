// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { fetchGenePlan } from "../../../crispr/backend";
import { planFailure } from "../../../crispr/contract";
import { plan } from "../../../crispr/plan.fixture";

vi.mock("../../../crispr/backend", () => ({ fetchGenePlan: vi.fn() }));
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@crispr/observability", () => ({
  getLogger: () => logs,
  withContext: (_: unknown, run: () => unknown) => run(),
}));
afterEach(() => vi.clearAllMocks());

const get = (gene: string) =>
  GET(new Request(`http://localhost/api/crispr/${gene}`), {
    params: Promise.resolve({ gene }),
  });

describe("CRISPR plan route", () => {
  it("returns a private, uncached plan for a valid gene", async () => {
    vi.mocked(fetchGenePlan).mockResolvedValue({ ok: true, plan });
    const response = await get("MEFV");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(await response.json()).toEqual({ ok: true, plan });
    expect(fetchGenePlan).toHaveBeenCalledWith(
      expect.objectContaining({ gene: "MEFV" }),
    );
    const telemetry = JSON.stringify([
      logs.info.mock.calls,
      logs.warn.mock.calls,
    ]);
    expect(telemetry).toContain("crispr_plan_completed");
    expect(telemetry).not.toContain(plan.edits[0]!.guides[0]!.spacer);
  });

  it("rejects a malformed gene name before calling the backend", async () => {
    const response = await get("bad%20name");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "invalid_gene" },
    });
    expect(fetchGenePlan).not.toHaveBeenCalled();
  });

  it("maps each failure to a distinct status", async () => {
    const statuses = {
      not_found: 404,
      backend_unavailable: 503,
      backend_timeout: 504,
      invalid_response: 502,
      canceled: 499,
    } as const;
    for (const [code, status] of Object.entries(statuses)) {
      vi.mocked(fetchGenePlan).mockResolvedValue(
        planFailure(code as keyof typeof statuses),
      );
      const response = await get("MEFV");
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code },
      });
    }
    expect(logs.warn).toHaveBeenCalledTimes(5);
  });
});
