import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DnaHelix, type DnaHelixProps } from "@crispr/human-model/dna";
import type { GenomeSequenceSource } from "@crispr/human-model/dna-sequence";
import { DEMO_CHROMOSOMES, DEMO_GENOME } from "./demo-genome";
import { GenomeExplorer } from "./genome-explorer";
import { genomeView } from "./genome-analysis/genome-view.fixture";
import { report } from "./genome-analysis/report.fixture";

vi.mock("next/dynamic", () => ({
  default: () =>
    function DnaDisplay(props: DnaHelixProps) {
      return <DnaHelix {...props} />;
    },
}));

const scene = vi.hoisted(() => ({
  setPosition: vi.fn(),
  setMode: vi.fn(),
  setHighlights: vi.fn(),
  setSequence: vi.fn(),
  setActive: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../../libs/human-model/src/dna-scene", () => ({
  DnaScene: class {
    setPosition = scene.setPosition;
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

it("navigates by one-based coordinates, repeats a previous jump, and switches chromosomes", async () => {
  render(<GenomeExplorer active />);
  act(() => frame?.(0));
  const input = screen.getByRole("spinbutton", { name: "Go to base" });
  fireEvent.change(input, { target: { value: "200000001" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "200,000,001 bp",
  );
  expect(scene.setPosition).toHaveBeenLastCalledWith(200_000_000, true);
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  viewport.scrollTop += 200;
  fireEvent.scroll(viewport);
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "200,000,011 bp",
  );
  fireEvent.submit(screen.getByRole("spinbutton").closest("form")!);
  expect(scene.setPosition).toHaveBeenLastCalledWith(200_000_000, true);
  fireEvent.change(screen.getByRole("combobox", { name: "Chromosome" }), {
    target: { value: "Y" },
  });
  act(() => frame?.(0));
  expect(screen.getByText("of 57,000,000")).toBeTruthy();
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "1,024,001 bp",
  );
  const nextInput = screen.getByRole("spinbutton");
  fireEvent.change(nextInput, { target: { value: "999999999" } });
  fireEvent.submit(nextInput.closest("form")!);
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "1,024,001 bp",
  );
  await screen.findByText("3D DNA ready");
});

it("unwinds and rewinds without losing the position, reloading sequence, or replacing the canvas", async () => {
  const readRange = vi.spyOn(DEMO_GENOME, "readRange");
  const { rerender } = render(<GenomeExplorer active />);
  act(() => frame?.(0));
  await screen.findByText("3D DNA ready");
  const canvas = document.querySelector("canvas");
  const reads = readRange.mock.calls.length;
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "200000001" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(readRange.mock.calls.length).toBe(reads + 1));
  fireEvent.click(screen.getByRole("button", { name: "Unwind double helix" }));
  expect(screen.getByRole("heading", { name: "Flat ladder" })).toBeTruthy();
  expect(scene.setMode).toHaveBeenLastCalledWith("ladder");
  expect(screen.getByLabelText("Current base").textContent).toBe(
    "200,000,001 bp",
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

it("maps backend regions to the minimap and jumps across chromosomes with exact reference context", async () => {
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
  expect(scene.setHighlights).toHaveBeenLastCalledWith([genomeView.regions[0]]);
  expect(scene.setSequence.mock.calls.at(-1)![0].bases).toContain(
    "ACGTATCTGGCA",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect MEFV at chr16:3293406" }),
  );
  act(() => frame?.(0));
  expect(
    screen
      .getByRole("combobox")
      .querySelector("option:checked")
      ?.getAttribute("value"),
  ).toBe("16");
  expect(scene.setPosition).toHaveBeenLastCalledWith(3293405, true);
  expect(screen.getByRole("slider").getAttribute("value")).toBe("3293405");
  fireEvent.change(screen.getByRole("slider"), {
    target: { value: "90338344" },
  });
  expect(scene.setPosition).toHaveBeenLastCalledWith(90338344, true);
  expect(screen.getByText(/Reference unavailable here/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Jump to MEFV at chr16:3293406" }),
  );
  expect(scene.setPosition).toHaveBeenLastCalledWith(3293405, true);
  const viewport = screen.getByRole("region", { name: "DNA sequence" });
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(screen.getByRole("slider").getAttribute("value")).toBe("3293406");
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
  expect(screen.queryByRole("slider")).toBeNull();
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
