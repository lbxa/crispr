import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEMO_REPORT } from "@crispr/ui/genome/report";
import { DISEASE_ARTWORK } from "../disease-artwork";
import { GenomeWorkspace } from "./genome-workspace";

vi.mock("next/dynamic", () => ({ default: () => () => <p>Body twin</p> }));
afterEach(cleanup);

it("has a local WebP illustration for every screened disease", () => {
  for (const result of DEMO_REPORT.results) {
    const path = DISEASE_ARTWORK[result.gene];
    expect(path).toBeDefined();
    const image = readFileSync(resolve("public", path!.slice(1)));
    expect(image.subarray(0, 4).toString()).toBe("RIFF");
    expect(image.subarray(8, 12).toString()).toBe("WEBP");
  }
});

it("filters image cards and opens a report drawer without promoting carriers to edit candidates", async () => {
  const { container } = render(
    <GenomeWorkspace
      report={DEMO_REPORT}
      modelUrls={{ male: "/male.glb", female: "/female.glb" }}
      summary={null}
      editPlan={null}
    />,
  );
  expect(container.querySelectorAll("[data-disease]")).toHaveLength(24);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "CFTR" },
  });
  expect(container.querySelectorAll("[data-disease]")).toHaveLength(1);
  const card = container.querySelector('[data-disease="CFTR"]')!;
  expect(within(card as HTMLElement).getByText("Carrier")).toBeTruthy();
  const disclosure = screen.getByRole("button", { name: "View CFTR report" });
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  const drawer = await screen.findByRole("dialog", { name: "Cystic fibrosis" });
  expect(within(drawer).getByText("One copy")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /See edit plan/ })).toBeNull();
  fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
