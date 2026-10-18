import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
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
  vi.useRealTimers();
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
    }).textContent,
  ).toContain("MEFV · Familial Mediterranean fever");
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Potentially viable",
    ),
  );
  expect(within(dialog).getByTestId("overview-score").textContent).toBe("56");
  expect(loadGenePlan).toHaveBeenCalledTimes(1);
  expect(vi.mocked(loadGenePlan).mock.calls[0]![0]).toBe("MEFV");
  // The technical detail stays out of the way until asked for.
  expect(
    within(dialog).getByRole("button", { name: /Advanced genomics/ }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("dialog", { name: "Advanced genomics" }),
  ).toBeNull();
  expect(within(dialog).queryByText(plan.disclaimer)).toBeNull();
  expect(within(dialog).queryByText("Raw API response")).toBeNull();
});

it("offers only the identified genes and loads each one once", async () => {
  const user = userEvent.setup();
  const onOpenChange = open("MEFV");
  const dialog = screen.getByRole("dialog");
  await waitFor(() => within(dialog).getByTestId("verdict"));
  const select = within(dialog).getByRole("combobox", { name: "Gene" });
  await user.click(select);
  const options = await screen.findByRole("listbox");
  expect(
    within(options)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["MEFV · Familial Mediterranean fever", "FGFR3 · Achondroplasia"]);

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(select);
  await user.click(select);
  await user.click(
    await screen.findByRole("option", { name: "FGFR3 · Achondroplasia" }),
  );
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Not supported",
    ),
  );
  expect(loadGenePlan).toHaveBeenCalledTimes(2);

  await user.click(select);
  await user.click(
    await screen.findByRole("option", {
      name: "MEFV · Familial Mediterranean fever",
    }),
  );
  await waitFor(() =>
    expect(within(dialog).getByTestId("verdict").textContent).toBe(
      "Potentially viable",
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
  expect(screen.getByTestId("verdict").textContent).toBe("Potentially viable");
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

it("shows the demo confirmation immediately with reduced motion and submits no order", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const onOpenChange = open("MEFV");
  await screen.findByTestId("verdict");
  const button = screen.getByRole("button", { name: "Order kit" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  const dialog = screen.getByRole("dialog", { name: "Order placed" });
  expect(within(dialog).queryByRole("combobox", { name: "Gene" })).toBeNull();
  expect(within(dialog).queryByTestId("crispr-plan")).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "Order kit" }),
  ).toBeNull();
  expect(
    within(dialog).getByRole("heading", { name: "Order placed", level: 3 }),
  ).toBe(document.activeElement);
  expect(request).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(loadGenePlan).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(onOpenChange.mock.calls[0]![0]).toBe(false);
});

it("acknowledges with a tick before replacing the drawer and ignores repeat activation", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.useFakeTimers();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  render(
    <CrisprDrawer
      open
      onOpenChange={vi.fn()}
      genes={genes}
      initialGene="MEFV"
      plans={[plan]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Order kit" }));
  const acknowledged = screen.getByRole("button", { name: "Confirmed" });
  expect(acknowledged.getAttribute("aria-disabled")).toBe("true");
  expect(acknowledged.querySelector('[data-icon="inline-start"]')).toBeTruthy();
  // JSDOM does not remove inert descendants from its accessibility queries.
  expect(
    screen.getByRole("combobox", { name: "Gene" }).closest("[inert]"),
  ).toBeTruthy();
  act(() => vi.advanceTimersByTime(500));
  fireEvent.click(acknowledged);
  act(() => vi.advanceTimersByTime(149));
  expect(screen.queryByRole("dialog", { name: "Order placed" })).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  const confirmation = screen.getByRole("dialog", { name: "Order placed" });
  expect(within(confirmation).queryByTestId("crispr-plan")).toBeNull();
  expect(
    within(confirmation).getByRole("heading", {
      name: "Order placed",
      level: 3,
    }),
  ).toBe(document.activeElement);
  expect(request).not.toHaveBeenCalled();
});

it.each([false, true])(
  "starts a fresh preview after closing with completed=%s",
  (completed) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.useFakeTimers();
    const props = {
      onOpenChange: vi.fn(),
      genes,
      initialGene: "MEFV",
      plans: [plan],
    };
    const view = render(<CrisprDrawer open {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Order kit" }));
    act(() => vi.advanceTimersByTime(completed ? 650 : 200));
    view.rerender(<CrisprDrawer open={false} {...props} />);
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(<CrisprDrawer open {...props} />);
    expect(
      screen.getByRole("dialog", { name: "CRISPR gene editing" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Order kit" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Gene" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("dialog", { name: "Order placed" })).toBeNull();
  },
);

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
      "No suitable guide",
    ),
  );
  expect(within(dialog).getByTestId("overview-score").textContent).toBe("—");
  fireEvent.click(within(dialog).getByText("Advanced genomics"));
  const advanced = await screen.findByRole("dialog", {
    name: "Advanced genomics",
  });
  const summary = within(advanced).getByRole("article", {
    name: "Editing target MEFV variant 2",
  });
  expect(within(summary).getByText("No guide candidates")).toBeTruthy();
  expect(
    within(advanced).getByText(
      /No SpCas9 guide could be designed within cutting distance/,
    ),
  ).toBeTruthy();
  expect(within(advanced).queryByRole("table")).toBeNull();
});

it("uses the uploaded genome's saved plans without requesting catalog examples", async () => {
  render(
    <CrisprDrawer
      open
      onOpenChange={vi.fn()}
      genes={genes}
      initialGene="MEFV"
      plans={[plan, notAdvisablePlan]}
      onDownloadReport={vi.fn()}
    />,
  );
  await screen.findByTestId("verdict");
  expect(loadGenePlan).not.toHaveBeenCalled();
  expect(screen.getByText("Research preview")).toBeTruthy();
  expect(screen.queryByText("Catalog example")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Download Report" })
      .hasAttribute("disabled"),
  ).toBe(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Gene" }));
  await user.click(
    await screen.findByRole("option", { name: "FGFR3 · Achondroplasia" }),
  );
  expect(screen.getByTestId("verdict").textContent).toBe("Not supported");
  expect(loadGenePlan).not.toHaveBeenCalled();
});

it("keeps all molecular evidence in a nested lab drawer", async () => {
  const first = plan.edits[0]!;
  const second = {
    ...first,
    variation_id: 3,
    variant: "MEFV variant 3",
    guides: [{ ...first.guides[0]!, allele_specific: false, cut_distance: 4 }],
    advisability: {
      ...first.advisability!,
      score: 18,
      recommended: false,
      band: "low" as const,
    },
  };
  vi.mocked(loadGenePlan).mockResolvedValue({
    ok: true,
    plan: { ...plan, edits: [first, second] },
  });
  open();
  await screen.findByTestId("verdict");
  const parent = screen.getByRole("dialog", { name: "CRISPR gene editing" });
  expect(screen.queryByRole("article", { name: /Editing target/ })).toBeNull();
  fireEvent.click(screen.getByText("Advanced genomics"));
  const advanced = await screen.findByRole("dialog", {
    name: "Advanced genomics",
  });
  for (const edit of [first, second]) {
    const card = screen.getByRole("article", {
      name: `Editing target ${edit.variant}`,
    });
    expect(advanced.contains(card)).toBe(true);
    expect(within(card).getByText(edit.guides[0]!.spacer)).toBeTruthy();
    expect(within(card).getByText(edit.guides[0]!.pam)).toBeTruthy();
    expect(
      within(card).getByRole("region", { name: "Guide G1 evidence" }),
    ).toBeTruthy();
  }
  const cards = screen.getAllByRole("article", { name: /Editing target/ });
  expect(within(cards[0]!).getByText("Mutant only")).toBeTruthy();
  expect(within(cards[1]!).getByText("Both alleles")).toBeTruthy();
  expect(within(cards[1]!).getByText("18.0 /100")).toBeTruthy();
  expect(
    within(within(cards[1]!).getByRole("table"))
      .getAllByRole("cell")
      .map((value) => value.textContent),
  ).toContain("4");
  expect(parent.isConnected).toBe(true);
  expect(
    within(parent).getByText("Your care team handles the details"),
  ).toBeTruthy();
  expect(within(advanced).getByText(plan.disclaimer)).toBeTruthy();
  expect(within(advanced).getAllByRole("table")).toHaveLength(2);
  expect(within(advanced).getAllByText(first.off_target)).toHaveLength(2);
});

it("keeps an unavailable prediction neutral while still showing the designed guides", async () => {
  vi.mocked(loadGenePlan).mockResolvedValue({
    ok: true,
    plan: {
      ...plan,
      overview: {
        ...plan.overview,
        verdict: "unavailable",
        score: null,
        band: null,
      },
      edits: [{ ...plan.edits[0]!, advisability: null }],
    },
  });
  open();
  await screen.findByTestId("verdict");
  expect(screen.getByTestId("verdict").textContent).toBe("Not enough data");
  expect(screen.getByTestId("overview-score").textContent).toBe("—");
  expect(screen.queryByRole("meter")).toBeNull();
  fireEvent.click(screen.getByText("Advanced genomics"));
  const advanced = await screen.findByRole("dialog", {
    name: "Advanced genomics",
  });
  expect(
    within(advanced).getByRole("region", { name: "Guide G1 evidence" }),
  ).toBeTruthy();
  expect(within(advanced).queryByText("Highest activity")).toBeNull();
  expect(
    screen.getByRole("article", { name: "Editing target MEFV variant 2" }),
  ).toBeTruthy();
});

it.each([
  [false, "right"],
  [true, "down"],
] as const)(
  "preserves the parent and its gene when the nested drawer closes (mobile=%s)",
  async (mobile, direction) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width") ? mobile : true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const user = userEvent.setup();
    const onOpenChange = open("FGFR3");
    await screen.findByTestId("verdict");
    const parent = screen.getByRole("dialog", { name: "CRISPR gene editing" });
    const trigger = within(parent).getByRole("button", {
      name: /Advanced genomics/,
    });
    for (const dismiss of ["close", "escape"]) {
      await user.click(trigger);
      const child = await screen.findByRole("dialog", {
        name: "Advanced genomics",
      });
      expect(child.getAttribute("data-swipe-direction")).toBe(direction);
      expect(parent.hasAttribute("data-nested-drawer-open")).toBe(true);
      expect(child.textContent).toContain("FGFR3 · Achondroplasia");
      if (dismiss === "close")
        await user.click(within(child).getByRole("button", { name: "Close" }));
      else await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Advanced genomics" }),
        ).toBeNull(),
      );
      expect(parent.isConnected).toBe(true);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(
        within(parent).getByRole("combobox", { name: "Gene" }).textContent,
      ).toContain("FGFR3");
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(loadGenePlan).toHaveBeenCalledOnce();
  },
);
