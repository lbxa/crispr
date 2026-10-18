import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SymptomsCard } from "./symptoms-card";

afterEach(cleanup);

describe("SymptomsCard", () => {
  it("starts empty and only adds examples when selected", async () => {
    const user = userEvent.setup();
    render(<SymptomsCard />);

    expect(screen.queryByRole("list", { name: "Your symptoms" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add fatigue" }));

    expect(screen.getByRole("button", { name: "Remove Fatigue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add fatigue" })).toBeNull();
  });

  it("adds comma-separated entries with Enter, trimming blanks and ignoring case-insensitive duplicates", async () => {
    const user = userEvent.setup();
    render(<SymptomsCard />);
    const input = screen.getByRole("textbox", { name: "Add symptoms" });

    await user.click(screen.getByRole("button", { name: "Add fatigue" }));
    await user.type(input, " fatigue, dizziness, , nausea, DIZZINESS {Enter}");

    const list = screen.getByRole("list", { name: "Your symptoms" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(list).getByRole("button", { name: "Remove dizziness" }),
    ).toBeTruthy();
    expect(
      within(list).getByRole("button", { name: "Remove nausea" }),
    ).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("supports adding by button and removing symptoms without submitting again", async () => {
    const user = userEvent.setup();
    render(<SymptomsCard />);
    const input = screen.getByRole("textbox", { name: "Add symptoms" });
    const add = screen.getByRole("button", { name: "Add" });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, "headache, joint pain");
    await user.click(add);
    await user.click(screen.getByRole("button", { name: "Remove headache" }));

    expect(
      screen.queryByRole("button", { name: "Remove headache" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove joint pain" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add headache" })).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });
});
