// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { analyzeGenome } from "../../genome-analysis/backend";
import { MAX_GENOME_BYTES } from "../../genome-analysis/contract";
import { report } from "../../genome-analysis/report.fixture";

vi.mock("../../genome-analysis/backend", () => ({ analyzeGenome: vi.fn() }));
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@crispr/observability", () => ({
  getLogger: () => logs,
  withContext: (_: unknown, run: () => unknown) => run(),
}));
afterEach(() => vi.clearAllMocks());

function upload(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("genome", file);
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    body: form,
  });
}

describe("genome upload route", () => {
  it("forwards one VCF and returns a private, uncached summary", async () => {
    vi.mocked(analyzeGenome).mockResolvedValue({ ok: true, report });
    const response = await POST(
      upload([new File(["VCF_CONTENT"], "genome.vcf")]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(await response.json()).toEqual({ ok: true, report });
    expect(analyzeGenome).toHaveBeenCalledWith(
      expect.objectContaining({ vcf: "VCF_CONTENT" }),
    );
    const telemetry = JSON.stringify([
      logs.info.mock.calls,
      logs.warn.mock.calls,
    ]);
    expect(telemetry).toContain("genome_analysis_completed");
    for (const privateText of [
      "VCF_CONTENT",
      "genome.vcf",
      report.summary.text,
    ]) {
      expect(telemetry).not.toContain(privateText);
    }
  });

  it.each([
    [],
    [new File(["text"], "notes.txt")],
    [new File([], "empty.vcf")],
    [new File(["a"], "a.vcf"), new File(["b"], "b.vcf")],
  ])("rejects an invalid upload before calling Python", async (...files) => {
    const response = await POST(upload(files));
    expect(response.status).toBe(400);
    expect(analyzeGenome).not.toHaveBeenCalled();
  });

  it("rejects files above the Python input limit", async () => {
    const response = await POST(
      upload([new File([new Uint8Array(MAX_GENOME_BYTES + 1)], "large.vcf")]),
    );
    expect(response.status).toBe(413);
    expect(analyzeGenome).not.toHaveBeenCalled();
  });

  it("rejects malformed multipart data", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: "bad",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns an actionable failure without pretending analysis succeeded", async () => {
    vi.mocked(analyzeGenome).mockResolvedValue({
      ok: false,
      error: {
        code: "backend_timeout",
        message: "Analysis took too long. Try again.",
      },
    });
    const response = await POST(
      upload([new File(["VCF_CONTENT"], "genome.vcf")]),
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "backend_timeout" },
    });
  });
});
