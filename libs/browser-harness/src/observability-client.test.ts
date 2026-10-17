import { describe, expect, test } from "bun:test";

import { createLokiRunQuery } from "./observability-client";

describe("observability client", () => {
  test("builds a run-scoped Loki query", () => {
    expect(createLokiRunQuery("run-1")).toBe(
      '{service_name=~".+"} | harness_run_id="run-1"',
    );
  });

  test("adds stable error and browser filters", () => {
    expect(
      createLokiRunQuery("run-1", {
        eventName: /^browser_console_/,
        level: "error",
        surface: "browser",
      }),
    ).toBe(
      '{service_name=~".+"} | harness_run_id="run-1" | level="error" | surface="browser" | event_name=~"^browser_console_"',
    );
  });
});
