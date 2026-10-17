import { describe, expect, test } from "bun:test";

import type { AppProcess } from "./app-process";
import { BrowserHarnessRuntime } from "./browser-harness-runtime";
import type { BrowserSession } from "./browser-session";
import { HarnessError } from "./errors";
import type { BrowserHarnessConfig } from "./types";

function config(): BrowserHarnessConfig {
  return {
    allowEvaluate: false,
    allowExternalUrls: false,
    allowRawCdp: false,
    appUrl: "http://127.0.0.1:3000/",
    captureScreenshots: true,
    captureVideo: false,
    evidenceDir: `${process.cwd()}/.harness/evidence`,
    failOnConsoleError: false,
    headless: true,
    localOnly: true,
    observability: {
      appName: "browser-harness-test",
      browserSessionId: "browser-session-test",
      harnessRunId: "harness-run-test",
      testName: "runtime",
    },
    persistBrowserState: false,
    reportNetworkFailures: true,
    startApp: false,
    startupTimeoutMs: 100,
    viewport: { height: 600, width: 800 },
    workspace: process.cwd(),
  };
}

async function captureHarnessError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HarnessError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the browser harness runtime to fail");
}

describe("BrowserHarnessRuntime lifecycle", () => {
  test("stop while the app starts prevents a later browser launch", async () => {
    // Arrange
    const calls: string[] = [];
    let finishAppStart: (() => void) | undefined;
    const appProcess = {
      async start() {
        calls.push("app:start");
        await new Promise<void>((resolve) => {
          finishAppStart = resolve;
        });
      },
      async stop() {
        calls.push("app:stop");
      },
    } as unknown as AppProcess;
    const browserSession = {
      async close() {
        calls.push("browser:close");
      },
      async start() {
        calls.push("browser:start");
      },
    } as unknown as BrowserSession;
    const runtime = new BrowserHarnessRuntime(
      config(),
      appProcess,
      browserSession,
    );

    // Act
    const starting = runtime.start();
    await runtime.stop();
    finishAppStart?.();
    const error = await captureHarnessError(starting);

    // Assert
    expect({ calls, code: error.code, message: error.message }).toEqual({
      calls: ["app:start", "browser:close", "app:stop"],
      code: "app_start_failed",
      message: "Browser harness startup was cancelled by a shutdown request",
    });
  });
});
