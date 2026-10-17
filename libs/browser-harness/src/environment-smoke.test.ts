import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  BROWSER_HARNESS_SMOKE_RESPONSE_TEXT,
  runBrowserHarnessEnvironmentSmoke,
} from "./environment-smoke";

const startServer = async () => ({
  port: 1,
  url: "http://127.0.0.1:1/",
});

describe("runBrowserHarnessEnvironmentSmoke", () => {
  test("classifies an unwritable temp/cache root as an environment blocker", async () => {
    // Arrange
    const missingTempRoot = join(
      process.cwd(),
      ".missing-browser-harness-smoke-temp-root",
      "child",
    );

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      tempRoot: missingTempRoot,
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.code).toBe(
      "environment_blocked_tempdir",
    );
  });

  test("classifies Chromium launch failure as a privileged browser runner requirement", async () => {
    // Arrange
    const launchChromium = async () => {
      throw new Error("bootstrap_check_in com.apple.runningboard failed");
    };

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      launchChromium,
      startServer,
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.code).toBe(
      "environment_blocked_browser_launch",
    );
    expect(result.success ? undefined : result.error.message).toContain(
      "privileged browser runner",
    );
  });

  test("classifies loopback bind failure as an environment blocker", async () => {
    // Arrange
    const blockedServer = async () => {
      throw new Error("bind EACCES 127.0.0.1");
    };

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      startServer: blockedServer,
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.code).toBe(
      "environment_blocked_loopback",
    );
  });

  test("classifies page navigation failure separately from browser launch", async () => {
    // Arrange
    const launchChromium = async () =>
      ({
        close: async () => undefined,
        newPage: async () => ({
          goto: async () => {
            throw new Error("loopback navigation denied");
          },
          locator: () => ({
            innerText: async () => BROWSER_HARNESS_SMOKE_RESPONSE_TEXT,
          }),
        }),
      }) as never;

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      launchChromium,
      startServer,
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.code).toBe(
      "environment_blocked_browser_navigation",
    );
  });

  test("passes when the browser can navigate, read the response, and close", async () => {
    // Arrange
    let closeCalls = 0;
    const launchChromium = async () =>
      ({
        close: async () => {
          closeCalls += 1;
        },
        newPage: async () => ({
          goto: async () => undefined,
          locator: () => ({
            innerText: async () => BROWSER_HARNESS_SMOKE_RESPONSE_TEXT,
          }),
        }),
      }) as never;

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      launchChromium,
      startServer,
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.success ? result.responseText : undefined).toBe(
      BROWSER_HARNESS_SMOKE_RESPONSE_TEXT,
    );
    expect(closeCalls).toBe(1);
  });

  test("classifies browser close failure as a browser lifecycle blocker", async () => {
    // Arrange
    const launchChromium = async () =>
      ({
        close: async () => {
          throw new Error("browser close denied");
        },
        newPage: async () => ({
          goto: async () => undefined,
          locator: () => ({
            innerText: async () => BROWSER_HARNESS_SMOKE_RESPONSE_TEXT,
          }),
        }),
      }) as never;

    // Act
    const result = await runBrowserHarnessEnvironmentSmoke({
      launchChromium,
      startServer,
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.code).toBe(
      "environment_blocked_browser_launch",
    );
  });
});
