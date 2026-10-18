// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { downloadLibraryGenome } from "./backend";
import { LIBRARY_GENOMES, MAX_LIBRARY_GENOME_BYTES } from "./catalog";

vi.mock("server-only", () => ({}));
const genome = LIBRARY_GENOMES[0]!;
const vcf = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\n";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("resolves the approved sample from the server catalog rather than assuming row 90", async () => {
  vi.stubEnv("CRISPR_API_URL", "https://backend.example");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([
        { id: 90, sample_id: "OTHER_SAMPLE" },
        { id: 123, sample_id: genome.sampleId },
      ]),
    )
    .mockResolvedValueOnce(new Response(vcf));
  vi.stubGlobal("fetch", fetch);
  const result = await downloadLibraryGenome(
    genome,
    new AbortController().signal,
    "request-1",
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(new TextDecoder().decode(result.content)).toBe(vcf);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "https://backend.example/genomes",
    "https://backend.example/genomes/123/genome.vcf",
  ]);
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    headers: { "X-Request-Id": "request-1" },
    cache: "no-store",
    redirect: "manual",
  });
});

it.each([
  { entries: [] },
  { entries: [{ id: 90, sample_id: "OTHER_SAMPLE" }] },
  {
    entries: [
      { id: 1, sample_id: genome.sampleId },
      { id: 2, sample_id: genome.sampleId },
    ],
  },
])("does not download an absent or ambiguous sample", async ({ entries }) => {
  const fetch = vi.fn().mockResolvedValue(Response.json(entries));
  vi.stubGlobal("fetch", fetch);
  expect(
    await downloadLibraryGenome(
      genome,
      new AbortController().signal,
      "request-2",
    ),
  ).toEqual({ ok: false, code: "unavailable" });
  expect(fetch).toHaveBeenCalledOnce();
});

it("rejects malformed catalog metadata and unexpected download bodies", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([{ id: "90", sample_id: genome.sampleId }]),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    await downloadLibraryGenome(
      genome,
      new AbortController().signal,
      "invalid",
    ),
  ).toEqual({ ok: false, code: "invalid_response" });
  fetch
    .mockResolvedValueOnce(
      Response.json([{ id: 90, sample_id: genome.sampleId }]),
    )
    .mockResolvedValueOnce(new Response("<html>Unavailable</html>"));
  expect(
    await downloadLibraryGenome(genome, new AbortController().signal, "html"),
  ).toEqual({ ok: false, code: "invalid_response" });
});

it("keeps large genomes out of the small demo download path", async () => {
  const body = new Response(vcf, {
    headers: { "Content-Length": String(MAX_LIBRARY_GENOME_BYTES + 1) },
  });
  const read = vi.spyOn(body, "arrayBuffer");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ id: 90, sample_id: genome.sampleId }]),
      )
      .mockResolvedValueOnce(body),
  );
  expect(
    await downloadLibraryGenome(genome, new AbortController().signal, "size"),
  ).toEqual({ ok: false, code: "invalid_response" });
  expect(read).not.toHaveBeenCalled();
});

it("does not follow an upstream redirect or start work after cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: "https://other.example" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await downloadLibraryGenome(
      genome,
      new AbortController().signal,
      "redirect",
    ),
  ).toEqual({ ok: false, code: "unavailable" });
  fetch.mockClear();
  expect(
    await downloadLibraryGenome(genome, AbortSignal.abort(), "cancel"),
  ).toEqual({ ok: false, code: "canceled" });
  expect(fetch).not.toHaveBeenCalled();
});
