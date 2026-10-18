// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { downloadLibraryGenome } from "../../../genome-library/backend";
import { LIBRARY_GENOMES } from "../../../genome-library/catalog";

vi.mock("../../../genome-library/backend", () => ({
  downloadLibraryGenome: vi.fn(),
}));
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@crispr/observability", () => ({
  getLogger: () => logs,
  withContext: (_: unknown, run: () => unknown) => run(),
}));
afterEach(() => vi.clearAllMocks());
const genome = LIBRARY_GENOMES[0]!;

it("serves only the curated file with a safe download name and correlated telemetry", async () => {
  const vcf = "##fileformat=VCFv4.2\nPRIVATE_VCF_CONTENT";
  vi.mocked(downloadLibraryGenome).mockResolvedValue({
    ok: true,
    content: new TextEncoder().encode(vcf).buffer,
  });
  const response = await GET(
    new Request("http://localhost/api/genome-library/ibm-demo-90"),
    { params: Promise.resolve({ id: genome.id }) },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(vcf);
  expect(response.headers.get("Content-Disposition")).toBe(
    `attachment; filename="${genome.fileName}"`,
  );
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  const telemetry = JSON.stringify([
    logs.info.mock.calls,
    logs.warn.mock.calls,
  ]);
  expect(telemetry).toContain("genome_library_download_completed");
  expect(telemetry).not.toContain(vcf);
});

it("rejects unlisted genomes without fetching arbitrary server files", async () => {
  const response = await GET(
    new Request("http://localhost/api/genome-library/other"),
    { params: Promise.resolve({ id: "other" }) },
  );
  expect(response.status).toBe(404);
  expect(downloadLibraryGenome).not.toHaveBeenCalled();
});

it.each([
  ["unavailable", 503],
  ["invalid_response", 502],
  ["timeout", 504],
  ["canceled", 499],
] as const)(
  "classifies %s without exposing backend details",
  async (code, status) => {
    vi.mocked(downloadLibraryGenome).mockResolvedValue({ ok: false, code });
    const response = await GET(
      new Request("http://localhost/api/genome-library/ibm-demo-90"),
      { params: Promise.resolve({ id: genome.id }) },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: "Couldn’t load this demo genome. Try again.",
    });
  },
);
