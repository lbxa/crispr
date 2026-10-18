// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@crispr/observability", () => ({
  getLogger: () => logs,
  withContext: (_: unknown, run: () => unknown) => run(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const get = (chromosome: string, query: string) =>
  GET(new Request(`http://localhost/api/reference/${chromosome}?${query}`), {
    params: Promise.resolve({ chromosome }),
  });

function backend(response: Response | Error) {
  const fetch = vi.fn(async (_url: URL | RequestInfo) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("reference sequence route", () => {
  it("proxies a valid range to the backend and lets caches keep it", async () => {
    vi.stubEnv("CRISPR_API_URL", "https://genomes.example");
    const fetch = backend(
      Response.json({ chromosome: "7", start: 10, end: 14, bases: "ACGN" }),
    );
    const response = await get("7", "start=10&end=14");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chromosome: "7",
      start: 10,
      end: 14,
      bases: "ACGN",
    });
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://genomes.example/reference/7?start=10&end=14",
    );
  });

  it("rejects bad chromosomes and ranges without calling the backend", async () => {
    const fetch = backend(Response.json({}));
    for (const [chromosome, query] of [
      ["chr7", "start=0&end=4"],
      ["7", "start=-1&end=4"],
      ["7", "start=4&end=4"],
      ["7", "start=0&end=16385"],
      ["7", "start=a&end=4"],
    ] as const)
      expect((await get(chromosome, query)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps backend failures and malformed answers to service errors", async () => {
    backend(new Response("missing", { status: 503 }));
    expect((await get("7", "start=0&end=4")).status).toBe(503);
    backend(new Response("nope", { status: 422 }));
    expect((await get("7", "start=0&end=4")).status).toBe(400);
    backend(new TypeError("network"));
    expect((await get("7", "start=0&end=4")).status).toBe(503);
    // The wrong interval, or bases that aren't DNA, never reach the viewer.
    backend(
      Response.json({ chromosome: "7", start: 1, end: 5, bases: "ACGT" }),
    );
    expect((await get("7", "start=0&end=4")).status).toBe(502);
    backend(
      Response.json({ chromosome: "7", start: 0, end: 4, bases: "ACXT" }),
    );
    expect((await get("7", "start=0&end=4")).status).toBe(502);
  });
});
