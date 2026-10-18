// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGenePlan, planBackendUrl } from "./backend";
import { plan } from "./plan.fixture";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const call = (gene = "MEFV", signal = new AbortController().signal) =>
  fetchGenePlan({ gene, signal, requestId: "run-1" });

describe("Python CRISPR plan gateway", () => {
  it("validates the plan and keeps backend-only sequence data out of the result", async () => {
    vi.stubEnv("CRISPR_PLAN_API_URL", "https://plans.example");
    const edit = plan.edits[0]!;
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        ...plan,
        edits: [
          {
            ...edit,
            repair_template: "PRIVATE_TEMPLATE",
            repair_template_notes: "PRIVATE_NOTES",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await call();
    expect(result).toEqual({ ok: true, plan });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://plans.example/genes/MEFV/crispr");
    expect(init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: { "X-Request-Id": "run-1" },
    });
  });

  it("prefers the plan backend, then the genome backend, then the default", () => {
    vi.stubEnv("CRISPR_API_URL", "https://genomes.example");
    vi.stubEnv("CRISPR_PLAN_API_URL", "");
    vi.unstubAllEnvs();
    vi.stubEnv("CRISPR_API_URL", "https://genomes.example");
    expect(planBackendUrl()).toBe("https://genomes.example");
    vi.stubEnv("CRISPR_PLAN_API_URL", "https://plans.example");
    expect(planBackendUrl()).toBe("https://plans.example");
    vi.unstubAllEnvs();
    expect(planBackendUrl()).toMatch(/^https:\/\//);
  });

  it("rejects an invalid gene name without calling the backend", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const gene of ["../etc", "A B", "", "X".repeat(40)])
      expect(await call(gene)).toMatchObject({
        ok: false,
        error: { code: "invalid_gene" },
      });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps unknown genes, server errors, bad bodies and bad shapes to distinct failures", async () => {
    const cases: [Response | Error, string][] = [
      [new Response("no", { status: 404 }), "not_found"],
      [new Response("no", { status: 500 }), "backend_unavailable"],
      [new Response("no", { status: 429 }), "backend_unavailable"],
      [new Response("<html>"), "invalid_response"],
      [Response.json({ gene: "MEFV" }), "invalid_response"],
      [new TypeError("fetch failed"), "backend_unavailable"],
    ];
    for (const [reply, code] of cases) {
      vi.stubGlobal(
        "fetch",
        reply instanceof Error
          ? vi.fn().mockRejectedValue(reply)
          : vi.fn().mockResolvedValue(reply),
      );
      expect(await call()).toMatchObject({ ok: false, error: { code } });
    }
  });

  it("distinguishes a caller cancellation from an upstream deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("aborted")));
    expect(await call("MEFV", controller.signal)).toMatchObject({
      error: { code: "canceled" },
    });
    const timedOut = AbortSignal.abort(
      new DOMException("deadline", "TimeoutError"),
    );
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timedOut);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timedOut.reason));
    expect(await call()).toMatchObject({ error: { code: "backend_timeout" } });
  });
});
