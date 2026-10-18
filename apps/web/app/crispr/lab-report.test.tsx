import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LabEditReport } from "./lab-report";
import { plan } from "./plan.fixture";

afterEach(cleanup);

it("shows complete guide evidence without interactive table rows and preserves design order", () => {
  const edit = plan.edits[0]!;
  const first = edit.guides[0]!;
  const second = {
    ...first,
    spacer: "ACGT".repeat(5),
    cut_position: 1105,
    cut_distance: 5,
    efficiency: 81.2,
    allele_specific: false,
  };
  render(
    <LabEditReport
      edit={{
        ...edit,
        guides: [first, second],
        advisability: {
          ...edit.advisability!,
          score: 81.2,
          best_guide: second.spacer,
        },
        repair_template: "ACGTACGT",
        repair_template_notes: "Saved repair notes",
      }}
    />,
  );
  const target = screen.getByRole("article", {
    name: "Editing target MEFV variant 2",
  });
  const rows = within(target).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(
    rows.slice(1).map((row) => within(row).getByRole("rowheader").textContent),
  ).toEqual(["G1", "G2"]);
  expect(
    within(rows[1]!)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["0", "55.8", "Mutant only"]);
  expect(
    within(rows[2]!)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["5", "81.2", "Both alleles"]);
  expect(target.querySelector("[aria-expanded], details, button")).toBeNull();
  const guide = within(target).getByRole("region", {
    name: "Guide G1 evidence",
  });
  expect(within(guide).getByText(first.spacer)).toBeTruthy();
  expect(within(guide).getByText(first.pam)).toBeTruthy();
  expect(within(guide).getByText(first.context!)).toBeTruthy();
  expect(within(guide).getByText("1,100")).toBeTruthy();
  expect(within(guide).getByText("− (reverse)")).toBeTruthy();
  expect(within(guide).getByText("45%")).toBeTruthy();
  expect(within(guide).getByText("112")).toBeTruthy();
  for (const note of first.notes)
    expect(within(guide).getByText(note)).toBeTruthy();
  for (const [name, value] of Object.entries(first.model_scores!)) {
    expect(within(guide).getByText(name)).toBeTruthy();
    expect(within(guide).getByText(value.toFixed(2))).toBeTruthy();
  }
  for (const energy of Object.values(first.energy!))
    expect(within(guide).getByText(energy.toFixed(2))).toBeTruthy();
  expect(within(guide).queryByText("Highest activity")).toBeNull();
  expect(
    within(
      within(target).getByRole("region", { name: "Guide G2 evidence" }),
    ).getByText("Highest activity"),
  ).toBeTruthy();
  for (const text of [
    edit.strategy,
    edit.rationale,
    edit.alternative,
    edit.off_target,
    edit.advisability!.basis,
    "ACGTACGT",
    "Saved repair notes",
  ]) {
    expect(within(target).getByText(text)).toBeTruthy();
  }
});

it("keeps unavailable predictions distinct from zero and shows missing evidence explicitly", () => {
  const edit = plan.edits[0]!;
  render(
    <LabEditReport
      edit={{
        ...edit,
        advisability: null,
        guides: [
          {
            ...edit.guides[0]!,
            efficiency: null,
            model_scores: null,
            energy: null,
            context: null,
          },
        ],
      }}
    />,
  );
  expect(screen.getAllByText("Not scored")).toHaveLength(2);
  expect(screen.getByText("Context unavailable")).toBeTruthy();
  expect(screen.getByText("Activity prediction unavailable")).toBeTruthy();
  expect(screen.getByText("Binding-energy estimates unavailable")).toBeTruthy();
  expect(screen.queryByText("Highest activity")).toBeNull();
});

it("retains a real zero activity estimate and empty-guide alternatives", () => {
  const edit = plan.edits[0]!;
  const view = render(
    <LabEditReport
      edit={{
        ...edit,
        guides: [{ ...edit.guides[0]!, efficiency: 0 }],
        advisability: { ...edit.advisability!, score: 0 },
      }}
    />,
  );
  expect(screen.getByText("0.0 /100")).toBeTruthy();
  expect(screen.getByText("0.0")).toBeTruthy();
  view.rerender(
    <LabEditReport edit={{ ...edit, guides: [], advisability: null }} />,
  );
  expect(screen.getByText("No guide candidates")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText(edit.alternative)).toBeTruthy();
});
