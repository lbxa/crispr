import { describe, expect, test } from "bun:test";
import type { Browser } from "playwright";

import { BrowserSession } from "./browser-session";
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
      testName: "browser-session",
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
  throw new Error("Expected the browser session to fail");
}

describe("BrowserSession startup", () => {
  test("close during launch cancels startup and closes the launched browser", async () => {
    // Arrange
    let closeCalls = 0;
    let launchCalls = 0;
    let newContextCalls = 0;
    let resolveLaunch: ((browser: Browser) => void) | undefined;
    const launchedBrowser = {
      async close() {
        closeCalls += 1;
      },
      async newContext() {
        newContextCalls += 1;
        throw new Error("newContext must not run after shutdown");
      },
    } as unknown as Browser;
    const launchBrowser = () => {
      launchCalls += 1;
      return new Promise<Browser>((resolve) => {
        resolveLaunch = resolve;
      });
    };
    const session = new BrowserSession(config(), launchBrowser);

    // Act
    const starting = session.start();
    await session.close();
    resolveLaunch?.(launchedBrowser);
    const error = await captureHarnessError(starting);

    // Assert
    expect({
      closeCalls,
      code: error.code,
      launchCalls,
      message: error.message,
      newContextCalls,
    }).toEqual({
      closeCalls: 1,
      code: "browser_launch_failed",
      launchCalls: 1,
      message: "Browser startup was cancelled by a shutdown request",
      newContextCalls: 0,
    });
  });
});
