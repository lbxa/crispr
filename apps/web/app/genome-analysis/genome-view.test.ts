import { expect, it, vi } from "vitest";
import { genomeView } from "./genome-view.fixture";
import { genomeViewSchema, referenceSequenceSource } from "./genome-view";
import { genomeReportSchema } from "./contract";
import { report } from "./report.fixture";

it("preserves backend allele coordinates and accepts empty and legacy maps", () => {
  expect(genomeViewSchema.parse(genomeView)).toEqual(genomeView);
  expect(
    genomeViewSchema.parse({ ...genomeView, regions: [] }).regions,
  ).toEqual([]);
  expect(
    genomeReportSchema.parse({ ...report, genome_view: genomeView })
      .genome_view,
  ).toEqual(genomeView);
  expect(genomeReportSchema.parse(report).genome_view).toBeUndefined();
});

it("rejects wrong assemblies, mixed coordinates, invalid contexts and duplicate identities", () => {
  for (const change of [
    { assembly: "GRCh37" },
    { version: 2 },
    { coordinate_system: "one-based" },
  ])
    expect(
      genomeViewSchema.safeParse({ ...genomeView, ...change }).success,
    ).toBe(false);
  const region = genomeView.regions[0]!;
  for (const change of [
    { start: -1 },
    { end: region.end + 1 },
    { chromosome: "1" },
    { reference_context: { ...region.reference_context, bases: "INVALID" } },
    {
      reference_context: {
        ...region.reference_context,
        start: region.start + 1,
      },
    },
  ])
    expect(
      genomeViewSchema.safeParse({
        ...genomeView,
        regions: [{ ...region, ...change }],
      }).success,
    ).toBe(false);
  expect(
    genomeViewSchema.safeParse({ ...genomeView, regions: [region, region] })
      .success,
  ).toBe(false);
  expect(
    genomeViewSchema.safeParse({
      ...genomeView,
      chromosomes: [genomeView.chromosomes[0], genomeView.chromosomes[0]],
    }).success,
  ).toBe(false);
});

it("returns exact reference context with unknown flanks and cancels bounded reads", async () => {
  const source = referenceSequenceSource(genomeView);
  const chromosome = genomeView.chromosomes[0]!;
  const region = genomeView.regions[0]!;
  const signal = new AbortController().signal;
  const bases = await source.readRange(
    chromosome,
    region.start - 6,
    region.end + 6,
    signal,
  );
  expect(bases).toBe("NNACGTATCTGGCANN");
  expect(
    await source.readRange(chromosome, region.start, region.end, signal),
  ).toBe(region.reference);
  expect(await source.readRange(chromosome, 0, 10, signal)).toBe(
    "N".repeat(10),
  );
  await expect(source.readRange(chromosome, 0, 1537, signal)).rejects.toThrow();
  await expect(source.readRange(chromosome, -1, 10, signal)).rejects.toThrow();
  await expect(
    source.readRange(chromosome, 0, 10, AbortSignal.abort()),
  ).rejects.toThrow();
});

it("fills positions outside the contexts from the GRCh38 reference, letting contexts win", async () => {
  const chromosome = genomeView.chromosomes[0]!;
  const region = genomeView.regions[0]!;
  const availability: boolean[] = [];
  const loader = vi.fn(
    async (
      _id: string,
      start: number,
      end: number,
      _signal: AbortSignal,
    ): Promise<string | null> => "T".repeat(end - start),
  );
  const source = referenceSequenceSource(genomeView, loader, (available) =>
    availability.push(available),
  );
  const signal = new AbortController().signal;
  // Without the reference these flanks were "NN"; now they come from it.
  expect(
    await source.readRange(
      chromosome,
      region.start - 6,
      region.end + 6,
      signal,
    ),
  ).toBe("TTACGTATCTGGCATT");
  expect(await source.readRange(chromosome, 0, 10, signal)).toBe(
    "T".repeat(10),
  );
  expect(loader).toHaveBeenLastCalledWith("7", 0, 10, signal);
  // An unavailable reference falls back to N and is reported, rather than failing the read.
  loader.mockResolvedValueOnce(null);
  expect(await source.readRange(chromosome, 0, 10, signal)).toBe(
    "N".repeat(10),
  );
  expect(availability).toEqual([true, true, false]);
});

it("fails on contradictory overlapping reference windows instead of displaying guessed bases", async () => {
  const region = genomeView.regions[0]!;
  const context = region.reference_context!;
  const view = genomeViewSchema.parse({
    ...genomeView,
    regions: [
      region,
      {
        ...region,
        id: "conflicting-context",
        reference_context: { ...context, bases: `T${context.bases.slice(1)}` },
      },
    ],
  });
  await expect(
    referenceSequenceSource(view).readRange(
      view.chromosomes[0]!,
      context.start,
      context.end,
      new AbortController().signal,
    ),
  ).rejects.toThrow("Conflicting reference contexts");
});
