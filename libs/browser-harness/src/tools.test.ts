import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";

import { HarnessError, toHarnessError } from "./errors";
import { runBrowserTool } from "./tools";
import type { BrowserHarness, ClickInput } from "./types";

function createFakeHarness(
  onClick: (input: ClickInput) => void,
): BrowserHarness {
  return {
    async click(input) {
      onClick(input);
      return { success: true };
    },
    async close() {
      return { success: true };
    },
    async console() {
      return { messages: [], success: true };
    },
    async network() {
      return { failedRequests: [], success: true };
    },
    async open(input) {
      return { success: true, url: input?.url ?? "http://127.0.0.1:3000/" };
    },
    async press() {
      return { success: true };
    },
    async pointer() {
      return { success: true };
    },
    async screenshot() {
      return { path: ".harness/evidence/fake.png", success: true };
    },
    async snapshot() {
      return {
        accessibilityTree: "",
        consoleErrors: [],
        failedRequests: [],
        pageErrors: [],
        runtimeExceptions: [],
        success: true,
        title: "Fake",
        url: "http://127.0.0.1:3000/",
        visibleText: "Fake",
      };
    },
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    async type() {
      return { success: true };
    },
    async setInputFiles() {
      return { success: true };
    },
    async wait() {
      return { success: true };
    },
    async waitForText() {
      return { matched: true, success: true };
    },
    async waitForUrl() {
      return { success: true };
    },
  };
}

describe("runBrowserTool", () => {
  test("validates pointer actions before dispatch", async () => {
    const harness = createFakeHarness(() => undefined);
    let moved: unknown;
    harness.pointer = async (input) => {
      moved = input;
      return { success: true };
    };
    await runBrowserTool(harness, "browser.pointer", {
      action: "move",
      x: 600,
      y: 200,
      steps: 10,
    });
    expect(moved).toEqual({ action: "move", x: 600, y: 200, steps: 10 });
    for (const params of [
      { action: "move", x: 10 },
      { action: "move", x: 0, y: 0, steps: 0 },
      { action: "click" },
    ]) {
      await expect(
        runBrowserTool(harness, "browser.pointer", params),
      ).rejects.toBeInstanceOf(ZodError);
    }
  });
  test("validates file upload arguments before dispatch", async () => {
    const harness = createFakeHarness(() => undefined);
    let selected: unknown;
    harness.setInputFiles = async (input) => {
      selected = input;
      return { success: true };
    };
    await runBrowserTool(harness, "browser.setInputFiles", {
      selector: "input[type=file]",
      path: "fixtures/demo.vcf",
    });
    expect(selected).toEqual({
      selector: "input[type=file]",
      path: "fixtures/demo.vcf",
    });
    await expect(
      runBrowserTool(harness, "browser.setInputFiles", {
        selector: "input",
        path: "",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
  test("routes browser tool calls through validated params", async () => {
    let clicked: ClickInput | undefined;
    const harness = createFakeHarness((input) => {
      clicked = input;
    });

    await runBrowserTool(harness, "browser.click", {
      selector: "#send",
      timeoutMs: 500,
    });

    expect(clicked).toEqual({ selector: "#send", timeoutMs: 500 });
  });

  test("rejects invalid params before calling the harness", async () => {
    let clickCount = 0;
    const harness = createFakeHarness(() => {
      clickCount += 1;
    });

    let error: unknown;
    try {
      await runBrowserTool(harness, "browser.click", {
        selector: "#send",
        timeoutMs: -1,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ZodError);
    expect(clickCount).toBe(0);
  });

  test("reports unsupported methods with structured harness errors", async () => {
    const harness = createFakeHarness(() => undefined);

    let error: unknown;
    try {
      await runBrowserTool(harness, "browser.nope", {});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HarnessError);
    if (!(error instanceof HarnessError)) {
      throw error;
    }
    expect(error.code).toBe("unsupported_method");
  });
});

describe("toHarnessError", () => {
  test("preserves existing harness errors", () => {
    const original = new HarnessError("browser_not_started", "missing browser");

    expect(toHarnessError(original, "invalid_config")).toBe(original);
  });

  test("wraps unknown errors with the requested fallback code", () => {
    const wrapped = toHarnessError(new Error("boom"), "app_start_failed");

    expect(wrapped).toBeInstanceOf(HarnessError);
    expect(wrapped.code).toBe("app_start_failed");
    expect(wrapped.message).toBe("boom");
  });
});
