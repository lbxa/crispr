import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";

import { AppProcess } from "./app-process";
import { HarnessError } from "./errors";
import type { BrowserHarnessConfig } from "./types";

const servers: Server[] = [];

function config(
  appUrl: string,
  overrides: Partial<BrowserHarnessConfig> = {},
): BrowserHarnessConfig {
  return {
    allowEvaluate: false,
    allowExternalUrls: false,
    allowRawCdp: false,
    appUrl,
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
      testName: "app-process",
    },
    persistBrowserState: false,
    reportNetworkFailures: true,
    startApp: false,
    startupTimeoutMs: 100,
    viewport: { height: 600, width: 800 },
    workspace: process.cwd(),
    ...overrides,
  };
}

async function startServer(status: number) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "text/plain" });
    response.end(String(status));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  servers.push(server);

  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function unusedLoopbackUrl() {
  const url = await startServer(200);
  const server = servers.pop();
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  return url;
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
  throw new Error("Expected the app process to fail");
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("AppProcess startup", () => {
  test("does not treat an attached 404 response as ready", async () => {
    // Arrange
    const appUrl = await startServer(404);
    const appProcess = new AppProcess(
      config(appUrl, { startupTimeoutMs: 1_000 }),
    );

    // Act
    const error = await captureHarnessError(appProcess.start());

    // Assert
    expect(error).toMatchObject({
      code: "app_start_timeout",
      message: expect.stringContaining("last HTTP status 404"),
    });
  });

  test("rejects an already-responsive target before starting an owned app", async () => {
    // Arrange
    const appUrl = await startServer(200);
    const appProcess = new AppProcess(
      config(appUrl, {
        appCommand: "bun -e 'process.exit(0)'",
        startApp: true,
      }),
    );

    // Act
    const error = await captureHarnessError(appProcess.start());

    // Assert
    expect(error).toMatchObject({
      code: "app_start_failed",
      message: expect.stringMatching(/already.*listening|already.*responding/i),
    });
  });

  test("reports a clean child exit and includes its buffered output", async () => {
    // Arrange
    const appUrl = await unusedLoopbackUrl();
    const appProcess = new AppProcess(
      config(appUrl, {
        appCommand:
          "bun -e 'process.stdout.write(\"startup usage output\\n\")'",
        startApp: true,
        startupTimeoutMs: 2_000,
      }),
    );

    // Act
    const error = await captureHarnessError(appProcess.start());

    // Assert
    expect(error).toMatchObject({
      code: "app_start_failed",
      message: expect.stringMatching(
        /code 0[\s\S]*stdout[\s\S]*startup usage output/,
      ),
    });
  });

  test("bounds startup diagnostics while retaining the latest app error", async () => {
    // Arrange
    const appUrl = await unusedLoopbackUrl();
    const appProcess = new AppProcess(
      config(appUrl, {
        appCommand:
          'bun -e \'process.stderr.write("discard-me-" + "x".repeat(70000) + "-underlying Bun command error\\n"); process.exit(2)\'',
        startApp: true,
        startupTimeoutMs: 2_000,
      }),
    );

    // Act
    const error = await captureHarnessError(appProcess.start());

    // Assert
    expect({
      code: error.code,
      containsDiscardedPrefix: error.message.includes("discard-me"),
      containsRecentError: error.message.includes(
        "underlying Bun command error",
      ),
      containsStreamLabel: error.message.includes("[stderr]"),
      messageLength: error.message.length,
    }).toEqual({
      code: "app_start_failed",
      containsDiscardedPrefix: false,
      containsRecentError: true,
      containsStreamLabel: true,
      messageLength: expect.any(Number),
    });
    expect(error.message.length).toBeLessThan(5_000);
  });

  test("stop during startup prevents the child process from launching", async () => {
    // Arrange
    const appUrl = await unusedLoopbackUrl();
    const appProcess = new AppProcess(
      config(appUrl, {
        appCommand: "bun -e 'setInterval(() => undefined, 1000)'",
        startApp: true,
        startupTimeoutMs: 250,
      }),
    );

    // Act
    const starting = appProcess.start();
    await appProcess.stop();
    const error = await captureHarnessError(starting);
    await appProcess.stop();

    // Assert
    expect(error).toMatchObject({
      code: "app_start_failed",
      message: expect.stringContaining("cancelled"),
    });
  });
});
