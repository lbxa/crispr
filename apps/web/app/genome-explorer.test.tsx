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
import { DnaHelix, type DnaHelixProps } from "@crispr/human-model/dna";
import type { GenomeSequenceSource } from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { GenomeExplorer } from "./genome-explorer";
import { loadGenePlan } from "./crispr/client";
import { plan } from "./crispr/plan.fixture";
import { genomeView } from "./genome-analysis/genome-view.fixture";
import { report } from "./genome-analysis/report.fixture";

vi.mock("./crispr/client", () => ({ loadGenePlan: vi.fn() }));

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
      onPositionChange={vi.fn()}
    />,
  );
  act(() => frame?.(0));
  await screen.findByText("This sequence could not be loaded.");
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
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "198,400,000 bp",
  );
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  viewport.scrollTop += 200;
  fireEvent.scroll(viewport);
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "198,400,010 bp",
  );
  // Either copy of a pair navigates the same chromosome.
  clickChromosome("1", "maternal", 0.8);
  expect(scene.glideTo).toHaveBeenLastCalledWith(198_399_999);
  // A point on another chromosome opens that chromosome there, without a slide.
  scene.glideTo.mockClear();
  clickChromosome("Y", "paternal", 0.5);
  act(() => frame?.(0));
  expect(scene.glideTo).not.toHaveBeenCalled();
  expect(screen.getByText("of 57,000,000")).toBeTruthy();
  expect(screen.getByText("Chr Y")).toBeTruthy();
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "28,500,001 bp",
  );
  expect(
    screen
      .getByRole("button", { name: "Chromosome Y" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  // From the keyboard, Enter opens a chromosome and Home/End reach its ends.
  const seven = screen.getByRole("button", { name: "Chromosome 7" });
  fireEvent.keyDown(seven, { key: "Enter" });
  act(() => frame?.(0));
  expect(screen.getByText("of 200,000,000")).toBeTruthy();
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "1,024,001 bp",
  );
  fireEvent.keyDown(seven, { key: "End" });
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "200,000,000 bp",
  );
  fireEvent.keyDown(seven, { key: "Home" });
  expect(screen.getByLabelText("Current base").textContent).toBe("1 bp");
  expect(cursor()).toBe("0");
  await screen.findByText("3D DNA ready");
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
  expect(screen.getByRole("heading", { name: "Flat ladder" })).toBeTruthy();
  expect(scene.setMode).toHaveBeenLastCalledWith("ladder");
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "198,400,000 bp",
  );
  expect(document.querySelector("canvas")).toBe(canvas);
  expect(scene.dispose).not.toHaveBeenCalled();
  expect(readRange.mock.calls.length).toBe(reads + 1);
  rerender(<GenomeExplorer active={false} />);
  rerender(<GenomeExplorer active />);
  expect(screen.getByRole("heading", { name: "Flat ladder" })).toBeTruthy();
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
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "117,559,590 bp",
  );
  expect(screen.getByLabelText("Selected finding").textContent).toContain(
    "Carrier",
  );
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
  expect(screen.getByText(/Reference unavailable here/)).toBeTruthy();
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

it("discloses a long finding list without hiding the selected mutation", async () => {
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

  const summary = screen.getByText("Browse findings").closest("summary")!;
  const disclosure = summary.closest("details")!;
  const selected = screen.getByLabelText("Selected finding");
  expect(disclosure.open).toBe(false);
  expect(summary.textContent).toContain("6");
  expect(disclosure.contains(selected)).toBe(false);
  expect(selected.textContent).toContain("CFTR");

  fireEvent.click(summary);
  expect(disclosure.open).toBe(true);
  fireEvent.click(
    screen.getAllByRole("button", {
      name: "Inspect MEFV at chr16:3293406",
    })[0]!,
  );

  expect(screen.getByLabelText("Current base").textContent).toBe(
    "3,293,406 bp",
  );
  expect(screen.getByLabelText("Selected finding").textContent).toContain(
    "MEFV",
  );
});

it("shows empty and unavailable maps without inventing regions or substituting demo DNA", () => {
  const { rerender } = render(<GenomeExplorer active hasGenome />);
  expect(screen.queryByRole("group", { name: /Karyotype/ })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "Finish genome analysis",
  );
  rerender(<GenomeExplorer active hasGenome report={report} />);
  expect(screen.getByRole("status").textContent).toContain(
    "Choose the file again",
  );
  rerender(
    <GenomeExplorer
      active
      hasGenome
      report={{ ...report, genome_view: { ...genomeView, regions: [] } }}
    />,
  );
  act(() => frame?.(0));
  expect(screen.getByText(/No flagged regions/)).toBeTruthy();
  expect(screen.queryByLabelText("Regions of interest")).toBeNull();
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
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "117,559,590 bp",
  );
  const helix = scene.instances.at(-1)!;
  act(() => helix.onGlide?.(60_000_000));
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "60,000,001 bp",
  );
  expect(cursor()).toBe("60000000");
  act(() => helix.onGlide?.(null));
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "120,000,001 bp",
  );
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

it("floats the disease name beside the helix only while a zone is close to the focus line", () => {
  openMapped();
  // The explorer opens on CFTR, a carrier finding: named, but not an editing target.
  const tag = screen.getByTestId("zone-tag");
  expect(tag.textContent).toContain("CFTR");
  expect(tag.textContent).toContain("Cystic fibrosis");
  expect(tag.textContent).toContain("Carrier · not an editing target");
  expect(within(tag).queryByRole("button", { name: "CRISPR" })).toBeNull();
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

it("offers CRISPR beside an editing target and opens the popup on that gene", async () => {
  openMapped();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect MEFV at chr16:3293406" }),
  );
  act(() => frame?.(0));
  const tag = screen.getByTestId("zone-tag");
  expect(tag.textContent).toContain("Familial Mediterranean fever");
  vi.mocked(loadGenePlan).mockResolvedValue({ ok: true, plan });

  fireEvent.click(within(tag).getByRole("button", { name: "CRISPR" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("combobox", {
      name: "Gene",
    }),
  ).toHaveProperty("value", "MEFV");
  // Only genes with a likely or possible finding can be chosen; the carrier gene cannot.
  expect(
    within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["MEFV · Familial Mediterranean fever"]);
  await waitFor(() => expect(loadGenePlan).toHaveBeenCalled());
  expect(vi.mocked(loadGenePlan).mock.calls[0]![0]).toBe("MEFV");
});

it("shows no tag or CRISPR button in the demo genome", () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  expect(screen.queryByTestId("zone-tag")).toBeNull();
  expect(screen.queryByRole("button", { name: "CRISPR" })).toBeNull();
});
