// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGenePlan } from "./client";
import { planFailure } from "./contract";
import { plan } from "./plan.fixture";

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;

describe("CRISPR plan client", () => {
  it("requests the route for the gene and returns the validated result", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, plan }));
    vi.stubGlobal("fetch", fetch);
    expect(await loadGenePlan("MEFV", signal())).toEqual({ ok: true, plan });
    expect(fetch.mock.calls[0]![0]).toBe("/api/crispr/MEFV");
  });

  it("passes a server-reported failure straight through", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(planFailure("not_found"), { status: 404 }),
        ),
    );
    expect(await loadGenePlan("MEFV", signal())).toEqual(
      planFailure("not_found"),
    );
  });

  it("never throws: bad bodies, network errors and cancellation become failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>")));
    expect(await loadGenePlan("MEFV", signal())).toMatchObject({
      error: { code: "invalid_response" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ok: true, plan: {} })),
    );
    expect(await loadGenePlan("MEFV", signal())).toMatchObject({
      error: { code: "invalid_response" },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    expect(await loadGenePlan("MEFV", signal())).toMatchObject({
      error: { code: "backend_unavailable" },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await loadGenePlan("MEFV", controller.signal)).toMatchObject({
      error: { code: "canceled" },
    });
  });
});
