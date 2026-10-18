// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGenome } from "./backend";
import { report } from "./report.fixture";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Python genome analysis gateway", () => {
  it("classifies an upstream deadline separately from transport failure", async () => {
    const timedOut = AbortSignal.abort(
      new DOMException("deadline", "TimeoutError"),
    );
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timedOut);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timedOut.reason));
    expect(
      await analyzeGenome({
        vcf: "data",
        signal: new AbortController().signal,
        requestId: "timeout",
      }),
    ).toMatchObject({ ok: false, error: { code: "backend_timeout" } });
  });
  it("sends genome-only input and validates the report without forwarding unused sequence data", async () => {
    vi.stubEnv("CRISPR_API_URL", "https://backend.example");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        ...report,
        extra_sequence: "PRIVATE_SEQUENCE",
        findings: [
          {
            tier: "possible",
            gene: "MEFV",
            disease: "Familial Mediterranean fever",
            crispr: ["PRIVATE_EDIT"],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await analyzeGenome({
      vcf: "PRIVATE_VCF",
      signal: new AbortController().signal,
      requestId: "run-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://backend.example/analyze"),
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({
          vcf: "PRIVATE_VCF",
          symptoms: "",
          use_llm: false,
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it.each([
    [422, "invalid_vcf"],
    [429, "backend_busy"],
    [500, "backend_unavailable"],
  ])(
    "classifies HTTP %i without exposing upstream details",
    async (status, code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ detail: "PRIVATE_VCF" }, { status }),
          ),
      );
      const result = await analyzeGenome({
        vcf: "data",
        signal: new AbortController().signal,
        requestId: "run-2",
      });
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_VCF");
    },
  );

  it.each([{}, { ...report, disclaimer: "" }])(
    "rejects incomplete reports",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      expect(
        await analyzeGenome({
          vcf: "data",
          signal: new AbortController().signal,
          requestId: "run-3",
        }),
      ).toMatchObject({ ok: false, error: { code: "invalid_response" } });
    },
  );

  it("classifies a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(
      await analyzeGenome({
        vcf: "data",
        signal: new AbortController().signal,
        requestId: "run-4",
      }),
    ).toMatchObject({ ok: false, error: { code: "backend_unavailable" } });
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    expect(
      await analyzeGenome({
        vcf: "data",
        signal: controller.signal,
        requestId: "run-5",
      }),
    ).toMatchObject({ ok: false, error: { code: "canceled" } });
  });
});

describe("Cloudflare Workers compatibility", () => {
  it("never asks fetch for redirect: error, which Workers rejects, and still refuses redirects", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://elsewhere.example" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await analyzeGenome({
      vcf: "data",
      signal: new AbortController().signal,
      requestId: "redirect",
    });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "backend_unavailable" },
    });
  });
});
