import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@crispr/ui/components/sonner";
import { DnaHelix, type DnaHelixProps } from "@crispr/human-model/dna";
import type { GenomeSequenceSource } from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { GenomeExplorer } from "./genome-explorer";
import { loadGenePlan } from "./crispr/client";
import { plan } from "./crispr/plan.fixture";
import { genomeView } from "./genome-analysis/genome-view.fixture";
import { report } from "./genome-analysis/report.fixture";

vi.mock("./crispr/client", () => ({ loadGenePlan: vi.fn() }));
vi.mock("@crispr/ui/components/sonner", () => ({
  toast: { info: vi.fn() },
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DnaDisplay(props: DnaHelixProps) {
      return <DnaHelix {...props} />;
    },
}));

const scene = vi.hoisted(() => ({
  instances: [] as { onGlide?: (position: number | null) => void }[],
  // Like reduced motion by default: the "slide" finishes at once. Tests that watch a slide turn it off.
  instantGlide: true,
  setPosition: vi.fn(),
  glideTo: vi.fn(),
  setMode: vi.fn(),
  setHighlights: vi.fn(),
  setSequence: vi.fn(),
  setActive: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../../libs/human-model/src/dna-scene", () => ({
  DnaScene: class {
    onGlide: ((position: number | null) => void) | undefined;
    constructor() {
      scene.instances.push(this);
    }
    setPosition = scene.setPosition;
    glideTo = (position: number) => {
      scene.glideTo(position);
      if (scene.instantGlide) this.onGlide?.(null);
    };
    setMode = scene.setMode;
    setHighlights = scene.setHighlights;
    setSequence = scene.setSequence;
    setActive = scene.setActive;
    dispose = scene.dispose;
  },
}));

const chromosome = DEMO_CHROMOSOMES[0]!;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  scene.instances.length = 0;
  scene.instantGlide = true;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Click a fraction of the way down one copy of a chromosome on the karyotype. */
function clickChromosome(
  id: string,
  copy: "maternal" | "paternal",
  fraction: number,
) {
  const hit = screen.getByTestId(`karyotype-${id}-${copy}`);
  vi.spyOn(hit, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 18,
    top: 100,
    height: 200,
    right: 18,
    bottom: 300,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  });
  fireEvent.click(hit, { clientY: 100 + fraction * 200 });
}

const cursor = () =>
  screen.getByTestId("karyotype-cursor").getAttribute("data-position");
const basePair = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: "Base pair" });

it("waits for activation and ignores aborted ranges after a large jump", async () => {
  const requests: {
    start: number;
    end: number;
    signal: AbortSignal;
    resolve: (bases: string) => void;
  }[] = [];
  const source: GenomeSequenceSource = {
    readRange: vi.fn(
      (_chromosome, start, end, signal) =>
        new Promise<string>((resolve) =>
          requests.push({ start, end, signal, resolve }),
        ),
    ),
  };
  const onPositionChange = vi.fn();
  const initial = { position: 1_024_000 };
  const { rerender, unmount } = render(
    <DnaHelix
      chromosome={chromosome}
      source={source}
      navigation={initial}
      active={false}
      onPositionChange={onPositionChange}
    />,
  );
  expect(requests).toHaveLength(0);
  act(() => frame?.(0));
  rerender(
    <DnaHelix
      chromosome={chromosome}
      source={source}
      navigation={initial}
      active
      onPositionChange={onPositionChange}
    />,
  );
  expect(requests).toHaveLength(1);
  rerender(
    <DnaHelix
      chromosome={chromosome}
      source={source}
      navigation={{ position: 200_000_000 }}
      active
      onPositionChange={onPositionChange}
    />,
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]!.signal.aborted).toBe(true);
  for (const request of requests)
    expect(request.end - request.start).toBeLessThanOrEqual(1536);
  await act(async () => {
    requests[1]!.resolve("A".repeat(requests[1]!.end - requests[1]!.start));
    requests[0]!.resolve("C".repeat(requests[0]!.end - requests[0]!.start));
  });
  expect(scene.setSequence).toHaveBeenCalledTimes(1);
  expect(scene.setSequence.mock.calls[0]![0].start).toBe(requests[1]!.start);
  expect(screen.getByText("3D DNA ready")).toBeTruthy();
  unmount();
  expect(requests[1]!.signal.aborted).toBe(true);
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it("recenters scrolling without moving genome coordinates and supports both chromosome ends", async () => {
  const changed = vi.fn();
  render(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 1_024_000 }}
      active
      onPositionChange={changed}
    />,
  );
  act(() => frame?.(0));
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  viewport.scrollTop += 32_000;
  fireEvent.scroll(viewport);
  expect(changed).toHaveBeenLastCalledWith(1_025_600);
  expect(viewport.scrollTop).toBe(40_960);
  fireEvent.scroll(viewport);
  expect(changed).toHaveBeenLastCalledWith(1_025_600);
  fireEvent.keyDown(viewport, { key: "End" });
  expect(changed).toHaveBeenLastCalledWith(chromosome.length - 1);
  fireEvent.keyDown(viewport, { key: "Home" });
  expect(changed).toHaveBeenLastCalledWith(0);
  Object.defineProperty(viewport, "clientHeight", { value: 400 });
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(changed).toHaveBeenLastCalledWith(1);
  fireEvent.keyDown(viewport, { key: "PageDown" });
  expect(changed).toHaveBeenLastCalledWith(21);
  fireEvent.keyDown(viewport, { key: "PageUp" });
  expect(changed).toHaveBeenLastCalledWith(1);
  fireEvent.keyDown(viewport, { key: "ArrowUp" });
  expect(changed).toHaveBeenLastCalledWith(0);
  await waitFor(() => expect(screen.getByText("3D DNA ready")).toBeTruthy());
});

it("rejects malformed source data and retries without recreating the display", async () => {
  const readRange = vi
    .fn<GenomeSequenceSource["readRange"]>()
    .mockResolvedValueOnce("invalid")
    .mockImplementation((_chromosome, start, end) =>
      Promise.resolve("G".repeat(end - start)),
    );
  render(
    <DnaHelix
      chromosome={chromosome}
      source={{ readRange }}
      navigation={{ position: 0 }}
      active
      loadingFallback={<span role="status">Sequence placeholder</span>}
      onPositionChange={vi.fn()}
    />,
  );
  expect(screen.getByText("Sequence placeholder")).toBeTruthy();
  act(() => frame?.(0));
  await screen.findByText("This sequence could not be loaded.");
  expect(screen.queryByText("Sequence placeholder")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry sequence" }));
  await screen.findByText("3D DNA ready");
  expect(readRange).toHaveBeenCalledTimes(2);
  expect(scene.dispose).not.toHaveBeenCalled();
});

it("generates repeatable overlapping demo ranges and supports cancellation", async () => {
  const controller = new AbortController();
  const first = await DEMO_GENOME.readRange(
    chromosome,
    100,
    200,
    controller.signal,
  );
  const next = await DEMO_GENOME.readRange(
    chromosome,
    150,
    250,
    controller.signal,
  );
  expect(first.slice(50)).toBe(next.slice(0, 50));
  expect(first).toMatch(/^[ACGT]{100}$/);
  controller.abort();
  await expect(
    DEMO_GENOME.readRange(chromosome, 0, 10, controller.signal),
  ).rejects.toThrow();
});

it("slides to a clicked point on a chromosome and switches chromosomes from the karyotype", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  // 80% of the way down chromosome 1 (demo length 248,000,000).
  clickChromosome("1", "paternal", 0.8);
  expect(scene.glideTo).toHaveBeenLastCalledWith(198_399_999);
  expect(basePair().value).toBe("198400000");
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  viewport.scrollTop += 200;
  fireEvent.scroll(viewport);
  expect(basePair().value).toBe("198400010");
  // Either copy of a pair navigates the same chromosome.
  clickChromosome("1", "maternal", 0.8);
  expect(scene.glideTo).toHaveBeenLastCalledWith(198_399_999);
  // A point on another chromosome opens that chromosome there, without a slide.
  scene.glideTo.mockClear();
  clickChromosome("Y", "paternal", 0.5);
  act(() => frame?.(0));
  expect(scene.glideTo).not.toHaveBeenCalled();
  expect(basePair().value).toBe("28500001");
  expect(
    screen
      .getByRole("button", { name: "Chromosome Y" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  // From the keyboard, Enter opens a chromosome and Home/End reach its ends.
  const seven = screen.getByRole("button", { name: "Chromosome 7" });
  fireEvent.keyDown(seven, { key: "Enter" });
  act(() => frame?.(0));
  expect(basePair().value).toBe("1024001");
  fireEvent.keyDown(seven, { key: "End" });
  expect(basePair().value).toBe("200000000");
  fireEvent.keyDown(seven, { key: "Home" });
  expect(basePair().value).toBe("1");
  expect(cursor()).toBe("0");
  await screen.findByText("3D DNA ready");
});

it("searches exact one-based coordinates without replacing the DNA viewer", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  const input = screen.getByRole("spinbutton", { name: "Base pair" });
  const search = screen.getByRole("search", { name: "Base pair search" });
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  const disposals = scene.dispose.mock.calls.length;

  for (const base of [90_000_000, 1, chromosome.length]) {
    fireEvent.change(input, { target: { value: String(base) } });
    fireEvent.submit(search);
    expect(scene.glideTo).toHaveBeenLastCalledWith(base - 1);
    expect(basePair().value).toBe(String(base));
    expect(cursor()).toBe(String(base - 1));
  }

  expect(screen.getByRole("region", { name: "DNA sequence" })).toBe(viewport);
  expect(scene.dispose).toHaveBeenCalledTimes(disposals);
  expect(screen.queryByText("Chr 1")).toBeNull();
});

it("keeps base-pair searches within the selected chromosome", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  clickChromosome("Y", "paternal", 0.5);
  act(() => frame?.(0));
  const input = screen.getByRole("spinbutton", { name: "Base pair" });
  const search = screen.getByRole("search", { name: "Base pair search" });
  const before = cursor();
  scene.glideTo.mockClear();

  for (const value of ["", "0", "-1", "1.5", "57000001"]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(search);
    expect(scene.glideTo).not.toHaveBeenCalled();
    expect(cursor()).toBe(before);
  }

  fireEvent.change(input, { target: { value: "57000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Go to base pair" }));
  expect(scene.glideTo).toHaveBeenLastCalledWith(56_999_999);
  expect(cursor()).toBe("56999999");
});

it("uses the live position as its editable value and follows every glide frame", async () => {
  scene.instantGlide = false;
  const { rerender } = render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  const input = basePair();
  const search = screen.getByRole("search", { name: "Base pair search" });
  expect(input.value).toBe("1024001");
  expect(screen.queryByLabelText("Current base")).toBeNull();
  fireEvent.change(input, { target: { value: "90000000" } });
  rerender(<GenomeExplorer active />);
  expect(input.value).toBe("90000000");
  expect(scene.glideTo).not.toHaveBeenCalled();

  fireEvent.submit(search);
  expect(scene.glideTo).toHaveBeenLastCalledWith(89_999_999);
  // After submitting, show the moving scene rather than flashing the destination.
  expect(input.value).toBe("1024001");
  const helix = scene.instances.at(-1)!;
  act(() => helix.onGlide?.(40_000_000));
  expect(input.value).toBe("40000001");
  expect(cursor()).toBe("40000000");
  act(() => helix.onGlide?.(null));
  expect(input.value).toBe("90000000");
});

it("discards unsubmitted edits on blur or navigation without losing a Go click", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  const input = basePair();
  const go = screen.getByRole("button", { name: "Go to base pair" });
  const guide = screen.getByRole("button", { name: "Sequence guide" });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input, { relatedTarget: guide });
  expect(input.value).toBe("1024001");

  fireEvent.change(input, { target: { value: "17" } });
  fireEvent.blur(input, { relatedTarget: go });
  fireEvent.click(go);
  expect(scene.glideTo).toHaveBeenLastCalledWith(16);
  expect(input.value).toBe("17");

  fireEvent.change(input, { target: { value: "100" } });
  fireEvent.keyDown(screen.getByRole("region", { name: "DNA sequence" }), {
    key: "Home",
  });
  expect(input.value).toBe("1");
  clickChromosome("Y", "paternal", 0.5);
  act(() => frame?.(0));
  expect(input.value).toBe("28500001");
  // Returning to an old coordinate must not resurrect its abandoned draft.
  clickChromosome("1", "maternal", 16 / (chromosome.length - 1));
  act(() => frame?.(0));
  expect(input.value).toBe("17");
});

it("keeps the exact position visible while the sequence key and context live in a drawer", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  clickChromosome("Y", "paternal", 0.5);
  const position = basePair().value;
  const disposals = scene.dispose.mock.calls.length;
  expect(screen.queryByLabelText("Base colors")).toBeNull();
  expect(screen.queryByText(/Synthetic sequence/)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Sequence guide" }));
  const guide = await screen.findByRole("dialog", { name: "Sequence guide" });
  expect(within(guide).getByLabelText("Base colors")).toBeTruthy();
  expect(within(guide).getByText(/Synthetic sequence/)).toBeTruthy();
  expect(within(guide).getByText("57,000,000 bp")).toBeTruthy();
  fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(basePair().value).toBe(position);
  expect(scene.dispose).toHaveBeenCalledTimes(disposals);
});

it("unwinds and rewinds without losing the position, reloading sequence, or replacing the canvas", async () => {
  const readRange = vi.spyOn(DEMO_GENOME, "readRange");
  const { rerender } = render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  const canvas = document.querySelector("canvas");
  const reads = readRange.mock.calls.length;
  clickChromosome("1", "maternal", 0.8);
  await waitFor(() => expect(readRange.mock.calls.length).toBe(reads + 1));
  fireEvent.click(screen.getByRole("button", { name: "Unwind double helix" }));
  expect(
    screen.getByRole("heading", { name: "Double helix (expanded)" }),
  ).toBeTruthy();
  expect(scene.setMode).toHaveBeenLastCalledWith("ladder");
  expect(basePair().value).toBe("198400000");
  expect(document.querySelector("canvas")).toBe(canvas);
  expect(scene.dispose).not.toHaveBeenCalled();
  expect(readRange.mock.calls.length).toBe(reads + 1);
  rerender(<GenomeExplorer active={false} />);
  rerender(<GenomeExplorer active />);
  expect(
    screen.getByRole("heading", { name: "Double helix (expanded)" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rewind double helix" }));
  expect(scene.setMode).toHaveBeenLastCalledWith("helix");
  expect(screen.getByRole("heading", { name: "Double helix" })).toBeTruthy();
  expect(document.querySelector("canvas")).toBe(canvas);
  await screen.findByText("3D DNA ready");
  readRange.mockRestore();
});

it("maps backend regions to pinging karyotype dots and jumps across chromosomes with exact reference context", async () => {
  render(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: genomeView }}
    />,
  );
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  expect(screen.queryByText("Demo genome")).toBeNull();
  expect(basePair().value).toBe("117559590");
  expect(
    within(screen.getByRole("article", { name: "Cystic fibrosis" })).getByText(
      "Carrier",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText("Carrier finding · Associated region shown in red"),
  ).toBeNull();
  // The region in view when the explorer opens counts as seen, so it does not pulse.
  expect(scene.setHighlights).toHaveBeenLastCalledWith([
    { start: 117559589, end: 117559593, pulse: false },
  ]);
  expect(scene.setSequence.mock.calls.at(-1)![0].bases).toContain(
    "ACGTATCTGGCA",
  );
  // A heterozygous finding marks one copy; a homozygous one marks both.
  const copies = (id: string) =>
    [...document.querySelectorAll(`[data-region="${id}"]`)].map((dot) =>
      dot.getAttribute("data-copy"),
    );
  expect(copies("fixture-cftr")).toEqual(["maternal"]);
  expect(copies("fixture-mefv")).toEqual(["maternal", "paternal"]);
  // Chromosomes absent from the genome are drawn but cannot be chosen.
  expect(
    screen
      .getByRole("button", { name: "Chromosome 1" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(screen.queryByTestId("karyotype-1-maternal")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect MEFV at chr16:3293406" }),
  );
  act(() => frame?.(0));
  expect(
    screen
      .getByRole("button", { name: "Chromosome 16" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(scene.setPosition).toHaveBeenLastCalledWith(3293405, true);
  expect(cursor()).toBe("3293405");
  fireEvent.keyDown(screen.getByRole("button", { name: "Chromosome 16" }), {
    key: "End",
  });
  expect(scene.setPosition).toHaveBeenLastCalledWith(90338344, true);
  fireEvent.click(screen.getByRole("button", { name: "Sequence guide" }));
  const guide = await screen.findByRole("dialog", { name: "Sequence guide" });
  expect(within(guide).getByText(/Reference unavailable here/)).toBeTruthy();
  fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: "Jump to MEFV at chr16:3293406" }),
  );
  expect(scene.glideTo).toHaveBeenLastCalledWith(3293405);
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(cursor()).toBe("3293406");
});

it("numbers the chromosomes and shows a tooltip the moment the pointer is over one", () => {
  render(
    <GenomeExplorer
      active
      hasGenome
      report={{
        ...report,
        genome: { ...report.genome, model_profile: "male" },
        genome_view: genomeView,
      }}
    />,
  );
  const labels = [...document.querySelectorAll("svg text")].map(
    ({ textContent }) => textContent,
  );
  // One "Chr." caption per pair (the X/Y pair shares one), each above its number(s).
  expect(labels.filter((text) => text === "Chr.")).toHaveLength(23);
  expect(labels.filter((text) => text !== "Chr.")).toEqual([
    ...Array.from({ length: 22 }, (_, index) => String(index + 1)),
    "X",
    "Y",
  ]);
  const tooltip = () => screen.queryByTestId("karyotype-tooltip")?.textContent;
  const copy = (id: string) =>
    document.querySelector(`[data-homolog="${id}"]`)!;
  // No pause: the label appears on the first pointer event over the chromosome.
  fireEvent.pointerEnter(copy("7-maternal"), { clientX: 120, clientY: 40 });
  expect(tooltip()).toBe("Chromosome 7, maternal");
  fireEvent.pointerMove(copy("3-paternal"), { clientX: 60, clientY: 40 });
  expect(tooltip()).toBe("Chromosome 3, paternal · not in this genome");
  fireEvent.pointerLeave(copy("3-paternal"));
  expect(tooltip()).toBeUndefined();
  // Mutation dots get the same instant label.
  fireEvent.pointerEnter(
    screen.getByRole("button", { name: "Jump to CFTR at chr7:117559590" }),
    { clientX: 120, clientY: 90 },
  );
  expect(tooltip()).toBe("CFTR · Cystic fibrosis · chr7:117559590");
  // Scrolling the strip hides it, since the label would no longer sit under the pointer.
  fireEvent.scroll(
    screen.getByRole("group", { name: "Karyotype, 46,XY" }).parentElement!,
  );
  expect(tooltip()).toBeUndefined();
});

it("marks the location only on the chromosome copy that was clicked", () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  const marker = () =>
    [...screen.getByTestId("karyotype-cursor").querySelectorAll("line")].map(
      (line) => line.getAttribute("data-copy"),
    );
  expect(marker()).toEqual(["maternal"]); // one copy, never the pair
  clickChromosome("1", "paternal", 0.5);
  expect(marker()).toEqual(["paternal"]);
  clickChromosome("1", "maternal", 0.25);
  expect(marker()).toEqual(["maternal"]);
  // In a male, Y exists only as the paternal copy, whichever copy was last chosen.
  clickChromosome("Y", "paternal", 0.5);
  expect(marker()).toEqual(["paternal"]);
  fireEvent.keyDown(screen.getByRole("button", { name: "Chromosome 7" }), {
    key: "Enter",
  });
  expect(marker()).toEqual(["paternal"]); // keyboard keeps the last chosen copy
});

it("draws 46,XX or 46,XY from the reported sex", () => {
  const { rerender } = render(
    <GenomeExplorer
      active
      hasGenome
      report={{
        ...report,
        genome: { ...report.genome, model_profile: "female" },
        genome_view: genomeView,
      }}
    />,
  );
  expect(screen.getByRole("group", { name: "Karyotype, 46,XX" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Chromosome Y" })).toBeNull();
  rerender(
    <GenomeExplorer
      active
      hasGenome
      report={{
        ...report,
        genome: { ...report.genome, model_profile: "male" },
        genome_view: genomeView,
      }}
    />,
  );
  expect(screen.getByRole("group", { name: "Karyotype, 46,XY" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Chromosome Y" })).toBeTruthy();
});

it("shows every disease card and variant location without a findings disclosure", async () => {
  const regions = [
    ...genomeView.regions,
    ...Array.from({ length: 4 }, (_, index) => ({
      ...genomeView.regions[1]!,
      id: `additional-finding-${index}`,
    })),
  ];
  render(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: { ...genomeView, regions } }}
    />,
  );
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");

  const grid = screen.getByLabelText("Disease findings");
  expect(within(grid).getAllByRole("article")).toHaveLength(2);
  expect(
    within(grid).getAllByRole("button", { name: /^Inspect / }),
  ).toHaveLength(6);
  expect(screen.queryByText("Browse findings")).toBeNull();
  expect(grid.querySelector("details")).toBeNull();
  expect(
    within(grid).getByRole("button", { name: "View CFTR report" }),
  ).toBeTruthy();
  expect(
    within(grid).getByRole("button", { name: "View MEFV report" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "Inspect MEFV at chr16:3293406",
    })[0]!,
  );

  expect(basePair().value).toBe("3293406");
  expect(
    screen
      .getAllByRole("button", { name: "Inspect MEFV at chr16:3293406" })[0]!
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it("keeps incomplete genome states out of the viewer and reports them as toasts", async () => {
  const { rerender } = render(<GenomeExplorer active hasGenome loading />);
  expect(
    screen.getByLabelText("Genome explorer").getAttribute("aria-busy"),
  ).toBe("true");
  expect(screen.getByRole("status").textContent).toBe(
    "Loading genome analysis",
  );
  expect(screen.queryByRole("group", { name: /Karyotype/ })).toBeNull();
  rerender(<GenomeExplorer active={false} hasGenome />);
  expect(toast.info).not.toHaveBeenCalled();
  rerender(<GenomeExplorer active hasGenome />);
  await waitFor(() =>
    expect(toast.info).toHaveBeenLastCalledWith("Genome analysis incomplete", {
      description: "Continue from the genome summary to see mapped findings.",
      id: "genome-analysis-incomplete",
    }),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Genome analysis incomplete")).toBeNull();
  rerender(<GenomeExplorer active hasGenome report={report} />);
  await waitFor(() =>
    expect(toast.info).toHaveBeenLastCalledWith("Genome map unavailable", {
      description: "Choose the file again to load its region map.",
      id: "genome-map-unavailable",
    }),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.queryByText("Choose the file again to load its region map."),
  ).toBeNull();
  rerender(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: { ...genomeView, regions: [] } }}
    />,
  );
  act(() => frame?.(0));
  expect(screen.queryByText(/No flagged regions/)).toBeNull();
  expect(screen.queryByLabelText("Disease findings")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sequence guide" }));
  const guide = await screen.findByRole("dialog", { name: "Sequence guide" });
  expect(within(guide).getByText(/No flagged regions/)).toBeTruthy();
});

// Two findings on chromosome 7 so one can be in view while the other has not been seen.
const twoFindings = {
  ...genomeView,
  regions: [
    genomeView.regions[0]!,
    {
      ...genomeView.regions[0]!,
      id: "fixture-second",
      start: 120_000_000,
      end: 120_000_001,
      reference_context: null,
    },
  ],
};

function openTwoFindings() {
  render(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: twoFindings }}
    />,
  );
  act(() => frame?.(0));
}

it("pulses findings until their region has been in view", () => {
  openTwoFindings();
  const unseen = (name: string) =>
    screen.getByRole("button", { name }).hasAttribute("data-unseen");
  const first = "Jump to CFTR at chr7:117559590";
  const second = "Jump to CFTR at chr7:120000001";
  // The finding opened on is already in view; the other one calls for attention.
  expect(unseen(first)).toBe(false);
  expect(unseen(second)).toBe(true);
  expect(scene.setHighlights).toHaveBeenLastCalledWith([
    { start: 117559589, end: 117559593, pulse: false },
    { start: 120_000_000, end: 120_000_001, pulse: true },
  ]);
  expect(
    screen
      .getByRole("button", { name: "Inspect CFTR at chr7:120000001" })
      .hasAttribute("data-unseen"),
  ).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: second }));
  expect(unseen(second)).toBe(false);
  expect(scene.setHighlights).toHaveBeenLastCalledWith([
    { start: 117559589, end: 117559593, pulse: false },
    { start: 120_000_000, end: 120_000_001, pulse: false },
  ]);
  expect(
    screen
      .getByRole("button", { name: "Inspect CFTR at chr7:120000001" })
      .hasAttribute("data-unseen"),
  ).toBe(false);
});

it("does not mark a finding as viewed while the pane is hidden", () => {
  const { rerender } = render(
    <GenomeExplorer
      active={false}
      hasGenome
      report={{ ...report, genome_view: twoFindings }}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "Jump to CFTR at chr7:117559590" })
      .hasAttribute("data-unseen"),
  ).toBe(true);
  rerender(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: twoFindings }}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "Jump to CFTR at chr7:117559590" })
      .hasAttribute("data-unseen"),
  ).toBe(false);
});

it("slides to a clicked finding and keeps the readout and karyotype cursor moving with it", () => {
  scene.instantGlide = false;
  openTwoFindings();
  fireEvent.click(
    screen.getByRole("button", { name: "Jump to CFTR at chr7:120000001" }),
  );
  expect(scene.glideTo).toHaveBeenLastCalledWith(120_000_000);
  expect(scene.setPosition).not.toHaveBeenCalledWith(120_000_000, true);
  // Until the helix reports its first animated frame the readout stays where it was, with no
  // one-frame flash of the destination.
  expect(basePair().value).toBe("117559590");
  const helix = scene.instances.at(-1)!;
  act(() => helix.onGlide?.(60_000_000));
  expect(basePair().value).toBe("60000001");
  expect(cursor()).toBe("60000000");
  act(() => helix.onGlide?.(null));
  expect(basePair().value).toBe("120000001");
});

it("selects a finding from its dot without also jumping to the clicked chromosome point", () => {
  openTwoFindings();
  scene.glideTo.mockClear();
  scene.setPosition.mockClear();
  fireEvent.click(
    screen.getByRole("button", { name: "Jump to CFTR at chr7:120000001" }),
  );
  expect(scene.glideTo).toHaveBeenCalledTimes(1);
  expect(scene.glideTo).toHaveBeenLastCalledWith(120_000_000);
  // Dots are keyboard buttons too.
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Jump to CFTR at chr7:117559590" }),
    { key: "Enter" },
  );
  expect(scene.glideTo).toHaveBeenLastCalledWith(117_559_589);
});

it("drags the helix with a mouse to scroll it, and leaves touch to native scrolling", () => {
  const changed = vi.fn();
  render(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 1_024_000 }}
      active
      onPositionChange={changed}
    />,
  );
  act(() => frame?.(0));
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  const start = viewport.scrollTop;
  fireEvent.pointerDown(viewport, {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientY: 200,
  });
  expect(viewport.parentElement?.hasAttribute("data-dragging")).toBe(true);
  fireEvent.pointerMove(viewport, { pointerId: 1, clientY: 160 });
  expect(viewport.scrollTop).toBe(start + 40); // dragging up pulls later bases into view
  fireEvent.pointerMove(viewport, { pointerId: 1, clientY: 190 });
  expect(viewport.scrollTop).toBe(start + 10); // incremental (+40, then -30), not anchored to the press
  fireEvent.pointerUp(viewport, { pointerId: 1 });
  expect(viewport.parentElement?.hasAttribute("data-dragging")).toBe(false);
  const settled = viewport.scrollTop;
  fireEvent.pointerMove(viewport, { pointerId: 1, clientY: 0 });
  expect(viewport.scrollTop).toBe(settled);
  fireEvent.pointerDown(viewport, {
    button: 0,
    pointerId: 2,
    pointerType: "touch",
    clientY: 200,
  });
  fireEvent.pointerMove(viewport, { pointerId: 2, clientY: 100 });
  expect(viewport.scrollTop).toBe(settled);
});

it("slides to an animated navigation without letting the scroll echo cancel it", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 1_024_000 }}
      active
      onPositionChange={changed}
    />,
  );
  act(() => frame?.(0));
  rerender(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 90_000_000, animate: true }}
      active
      onPositionChange={changed}
    />,
  );
  expect(scene.glideTo).toHaveBeenLastCalledWith(90_000_000);
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  fireEvent.scroll(viewport); // the browser echoes our own scrollTop write
  expect(changed).not.toHaveBeenCalled();
  viewport.scrollTop += 100; // a real user scroll afterwards is honoured
  fireEvent.scroll(viewport);
  expect(changed).toHaveBeenLastCalledWith(90_000_005);
});

it("continues scrolling from the visible DNA when a jump is interrupted", () => {
  const changed = vi.fn();
  const { rerender } = render(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 1_024_000 }}
      active
      onPositionChange={changed}
    />,
  );
  act(() => frame?.(0));
  scene.instantGlide = false;
  rerender(
    <DnaHelix
      chromosome={chromosome}
      source={DEMO_GENOME}
      navigation={{ position: 90_000_000, animate: true }}
      active
      onPositionChange={changed}
    />,
  );
  act(() => scene.instances.at(-1)?.onGlide?.(40_000_000));

  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  fireEvent.scroll(viewport); // A frame's own scroll write must not cancel the jump.
  expect(changed).not.toHaveBeenCalled();
  viewport.scrollTop += 100;
  fireEvent.scroll(viewport);

  expect(changed).toHaveBeenLastCalledWith(40_000_005);
});

// CFTR is only a carrier finding; MEFV is a possible disease and so an editing target.
const mappedReport = {
  ...report,
  genome_view: genomeView,
  findings: [
    { tier: "carrier" as const, gene: "CFTR", disease: "Cystic fibrosis" },
    {
      tier: "possible" as const,
      gene: "MEFV",
      disease: "Familial Mediterranean fever",
    },
  ],
};

function openMapped() {
  render(<GenomeExplorer active hasGenome report={mappedReport} />);
  act(() => frame?.(0));
}

it("places the reviewed carrier association on its finding card", () => {
  const finding = {
    tier: "carrier" as const,
    gene: "PAH",
    disease: "Phenylketonuria",
  };
  render(
    <GenomeExplorer
      active
      hasGenome
      report={{
        ...report,
        findings: [finding],
        genome_view: {
          ...genomeView,
          chromosomes: [{ id: "12", length: 133275309 }],
          regions: [
            {
              // Synthetic coordinates test message placement, not clinical evidence.
              ...genomeView.regions[0]!,
              chromosome: "12",
              annotations: [finding],
            },
          ],
        },
      }}
    />,
  );
  const card = screen.getByRole("article", { name: "Phenylketonuria" });
  expect(
    within(card).getByText("Carrier finding · Associated region shown in red"),
  ).toBeTruthy();
  expect(within(card).getByText(": Head & brain")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Open CRISPR editor/ }),
  ).toBeNull();
});

it("floats the disease name beside the helix only while a zone is close to the focus line", () => {
  openMapped();
  // The explorer opens on CFTR, a carrier finding: named, but not an editing target.
  const tag = screen.getByTestId("zone-tag");
  expect(tag.textContent).toContain("CFTR");
  expect(tag.textContent).toContain("Cystic fibrosis");
  expect(tag.textContent).toContain("Carrier · not an editing target");
  expect(
    screen.queryByRole("button", { name: /Open CRISPR editor/ }),
  ).toBeNull();
  expect(tag.style.getPropertyValue("--zone-offset")).toBe("0px");

  // Moving away removes it, and coming back brings it back where the zone now sits.
  const at = (base: number) =>
    clickChromosome("7", "maternal", base / (159_345_973 - 1));
  at(100_000_000);
  expect(cursor()).toBe("100000000");
  expect(screen.queryByTestId("zone-tag")).toBeNull();
  at(117_559_584); // 5 bases before the zone
  expect(
    screen.getByTestId("zone-tag").style.getPropertyValue("--zone-offset"),
  ).toBe("100px");
  at(117_559_560); // 29 bases away
  expect(screen.queryByTestId("zone-tag")).toBeNull();
});

it("floats scissors on an editing target and opens the popup on that gene", async () => {
  openMapped();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect MEFV at chr16:3293406" }),
  );
  act(() => frame?.(0));
  const tag = screen.getByTestId("zone-tag");
  expect(tag.textContent).toContain("Familial Mediterranean fever");
  vi.mocked(loadGenePlan).mockResolvedValue({ ok: true, plan });

  const scissors = screen.getByRole("button", {
    name: "Open CRISPR editor for MEFV",
  });
  expect(tag.contains(scissors)).toBe(false);
  expect(scissors.getAttribute("aria-haspopup")).toBe("dialog");
  fireEvent.click(scissors);
  const dialog = await screen.findByRole("dialog");
  const geneSelect = within(dialog).getByRole("combobox", { name: "Gene" });
  expect(geneSelect.textContent).toContain(
    "MEFV · Familial Mediterranean fever",
  );
  // Only genes with a likely or possible finding can be chosen; the carrier gene cannot.
  fireEvent.click(geneSelect);
  act(() => frame?.(0));
  const options = await screen.findByRole("listbox");
  expect(
    within(options)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["MEFV · Familial Mediterranean fever"]);
  await waitFor(() => expect(loadGenePlan).toHaveBeenCalled());
  expect(vi.mocked(loadGenePlan).mock.calls[0]![0]).toBe("MEFV");
});

it("shows no tag or scissors tool in the demo genome", () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  expect(screen.queryByTestId("zone-tag")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Open CRISPR editor/ }),
  ).toBeNull();
});
