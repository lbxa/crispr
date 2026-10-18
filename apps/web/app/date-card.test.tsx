import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DateCard } from "./date-card";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps the local date current across midnight and returning to the tab", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 30));
  const { unmount } = render(<DateCard />);
  expect(
    screen
      .getByLabelText("Saturday, October 17, 2026")
      .getAttribute("datetime"),
  ).toBe("2026-10-17");

  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByLabelText("Sunday, October 18, 2026")).toBeTruthy();

  vi.setSystemTime(new Date(2026, 9, 19, 8));
  fireEvent.focus(window);
  expect(screen.getByLabelText("Monday, October 19, 2026")).toBeTruthy();

  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
