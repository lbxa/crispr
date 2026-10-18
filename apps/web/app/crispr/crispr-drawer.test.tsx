import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { CrisprDrawer } from "./crispr-drawer";
import { loadGenePlan } from "./client";
import { planFailure } from "./contract";
import { notAdvisablePlan, plan } from "./plan.fixture";

vi.mock("./client", () => ({ loadGenePlan: vi.fn() }));

const genes = [
  { gene: "MEFV", disease: "Familial Mediterranean fever" },
  { gene: "FGFR3", disease: "Achondroplasia" },
];

beforeEach(() => {
  // Reduced motion: the score appears at once instead of animating up.
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.mocked(loadGenePlan).mockImplementation(async (gene) => ({
    ok: true,
    plan: gene === "FGFR3" ? notAdvisablePlan : plan,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function open(initialGene = "MEFV", onOpenChange = vi.fn()) {
  render(
    <CrisprDrawer
      open
      onOpenChange={onOpenChange}
      genes={genes}
      initialGene={initialGene}
    />,
  );
  return onOpenChange;
}

it.each([
  [false, "right"],
  [true, "down"],
] as const)("opens with mobile=%s from %s", async (mobile, direction) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? mobile : true,
    addEventListener() {},
    removeEventListener() {},
  }));
  open();
  const drawer = await screen.findByRole("dialog", {
    name: "CRISPR gene editing",
  });
  expect(drawer.getAttribute("data-swipe-direction")).toBe(direction);
});

it("opens on the gene it was launched from and shows the plain-language verdict first", async () => {
  open("MEFV");
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("status").textContent).toContain(
    "Predicting how well MEFV can be edited",
  );
  expect(
    within(dialog).getByRole("combobox", {
      name: "Gene",
    }),
  ).toHaveProperty("value", "MEFV");
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Gene editing looks promising",
    ),
  );
  expect(within(dialog).getByTestId("overview-score").textContent).toBe("56");
  expect(loadGenePlan).toHaveBeenCalledTimes(1);
  expect(vi.mocked(loadGenePlan).mock.calls[0]![0]).toBe("MEFV");
  // The technical detail stays out of the way until asked for.
  const advanced = within(dialog).getByTestId("advanced");
  expect((advanced as HTMLDetailsElement).open).toBe(false);
  expect(within(dialog).getByText(plan.disclaimer)).toBeTruthy();
});

it("offers only the identified genes and loads each one once", async () => {
  open("MEFV");
  const dialog = screen.getByRole("dialog");
  await waitFor(() => within(dialog).getByTestId("verdict"));
  const select = within(dialog).getByRole("combobox", { name: "Gene" });
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["MEFV · Familial Mediterranean fever", "FGFR3 · Achondroplasia"]);

  fireEvent.change(select, { target: { value: "FGFR3" } });
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Gene editing looks unlikely to work well",
    ),
  );
  expect(loadGenePlan).toHaveBeenCalledTimes(2);

  fireEvent.change(select, { target: { value: "MEFV" } });
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Gene editing looks promising",
    ),
  );
  expect(loadGenePlan).toHaveBeenCalledTimes(2); // MEFV was already loaded
});

it("cancels the development effect replay and displays the surviving request", async () => {
  render(
    <StrictMode>
      <CrisprDrawer
        open
        onOpenChange={vi.fn()}
        genes={genes}
        initialGene="MEFV"
      />
    </StrictMode>,
  );
  await screen.findByTestId("verdict");
  expect(loadGenePlan).toHaveBeenCalledTimes(2);
  expect(vi.mocked(loadGenePlan).mock.calls[0]![1].aborted).toBe(true);
  expect(screen.getByTestId("verdict").textContent).toBe(
    "Gene editing looks promising",
  );
});

it("explains a failure and retries it", async () => {
  vi.mocked(loadGenePlan).mockResolvedValueOnce(
    planFailure("backend_unavailable"),
  );
  open("MEFV");
  const dialog = screen.getByRole("dialog");
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toContain("CRISPR analysis service is unavailable");
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await waitFor(() => within(dialog).getByTestId("verdict"));
  expect(loadGenePlan).toHaveBeenCalledTimes(2);
  expect(within(dialog).queryByRole("alert")).toBeNull();
});

it("does not offer a retry for a gene that has no editing plan", async () => {
  vi.mocked(loadGenePlan).mockResolvedValue(planFailure("not_found"));
  open("MEFV");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("isn't available for this gene");
  expect(within(alert).queryByRole("button")).toBeNull();
});

it("closes from its close button", async () => {
  const onOpenChange = open("MEFV");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
  expect(onOpenChange.mock.calls[0]![0]).toBe(false);
});

it("says plainly when no editing site exists near the variant", async () => {
  const edit = { ...plan.edits[0]!, guides: [], advisability: null };
  vi.mocked(loadGenePlan).mockResolvedValue({
    ok: true,
    plan: {
      ...plan,
      overview: {
        ...plan.overview,
        verdict: "no_guide",
        score: null,
        band: null,
        target: null,
        headline: "No standard SpCas9 guide could be designed.",
      },
      edits: [edit],
    },
  });
  open("MEFV");
  const dialog = screen.getByRole("dialog");
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "No suitable edit site found",
    ),
  );
  expect(within(dialog).getByTestId("overview-score").textContent).toBe("—");
  fireEvent.click(within(dialog).getByText("Advanced genomics"));
  expect(
    within(dialog).getByText(
      /No SpCas9 guide could be designed within cutting distance/,
    ),
  ).toBeTruthy();
  expect(within(dialog).queryByRole("table")).toBeNull();
});
