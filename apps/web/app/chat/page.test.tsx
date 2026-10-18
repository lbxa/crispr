import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ChatPage, { metadata } from "./page";

afterEach(cleanup);

it("embeds the same-origin workbench with microphone access", () => {
  render(<ChatPage />);
  const frame = screen.getByTitle("Crispr chat workbench");
  expect(frame.getAttribute("src")).toBe("/workbench/index.html");
  expect(frame.getAttribute("allow")).toBe("microphone");
  expect(
    screen.getByRole("heading", { name: "Crispr chat workbench" }),
  ).toBeTruthy();
});

it("states the prototype limits in the page description", () => {
  expect(String(metadata.description)).toMatch(/not medical advice/i);
});
