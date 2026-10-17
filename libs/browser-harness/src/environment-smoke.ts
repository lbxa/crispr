import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { HarnessError } from "./errors";
import type { EnvironmentBlockedErrorCode } from "./types";

export const BROWSER_HARNESS_SMOKE_RESPONSE_TEXT = "browser-harness-smoke-ok";

const DEFAULT_TIMEOUT_MS = 15_000;

type LaunchChromium = (options: {
  headless: true;
  timeout: number;
}) => Promise<Pick<Browser, "close" | "newPage">>;

type SmokeServer = {
  port: number;
  server?: Server;
  url: string;
};

type StartSmokeServer = () => Promise<SmokeServer>;

export type BrowserHarnessEnvironmentSmokeOptions = {
  launchChromium?: LaunchChromium;
  startServer?: StartSmokeServer;
  tempRoot?: string;
  timeoutMs?: number;
};

export type BrowserHarnessEnvironmentSmokeResult =
  | {
      durationMs: number;
      port: number;
      responseText: string;
      success: true;
      tempDir: string;
      url: string;
    }
  | {
      error: HarnessError & { code: EnvironmentBlockedErrorCode };
      success: false;
    };

export async function runBrowserHarnessEnvironmentSmoke(
  options: BrowserHarnessEnvironmentSmokeOptions = {},
): Promise<BrowserHarnessEnvironmentSmokeResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let browser: Pick<Browser, "close" | "newPage"> | undefined;
  let server: Server | undefined;
  let tempDir: string | undefined;

  try {
    tempDir = await createWritableTempCache(options.tempRoot);
    const smokeServer = await bindSmokeServer(options.startServer);
    server = smokeServer.server;

    browser = await launchSmokeBrowser(options.launchChromium, timeoutMs);
    const responseText = await readSmokePage(
      browser,
      smokeServer.url,
      timeoutMs,
    );
    await closeSmokeBrowser(browser, timeoutMs);
    browser = undefined;

    return {
      durationMs: Date.now() - startedAt,
      port: smokeServer.port,
      responseText,
      success: true,
      tempDir,
      url: smokeServer.url,
    };
  } catch (error) {
    return {
      error: toEnvironmentBlockedError(error),
      success: false,
    };
  } finally {
    await closeServer(server);
    await closeBrowserAfterFailure(browser, Math.min(timeoutMs, 1_000));
    await removeTempDir(tempDir);
  }
}

export function isEnvironmentBlockedError(
  error: unknown,
): error is HarnessError & { code: EnvironmentBlockedErrorCode } {
  return error instanceof HarnessError && isEnvironmentBlockedCode(error.code);
}

export function isEnvironmentBlockedCode(
  code: string,
): code is EnvironmentBlockedErrorCode {
  return (
    code === "environment_blocked_tempdir" ||
    code === "environment_blocked_loopback" ||
    code === "environment_blocked_browser_launch" ||
    code === "environment_blocked_browser_navigation"
  );
}

async function createWritableTempCache(tempRoot = tmpdir()) {
  try {
    const tempDir = await mkdtemp(join(tempRoot, "browser-harness-smoke-"));
    const cacheDir = join(tempDir, "cache");
    const probePath = join(cacheDir, "probe.txt");

    await mkdir(cacheDir);
    await writeFile(probePath, BROWSER_HARNESS_SMOKE_RESPONSE_TEXT, "utf8");

    const probe = await readFile(probePath, "utf8");
    if (probe !== BROWSER_HARNESS_SMOKE_RESPONSE_TEXT) {
      throw new Error("Temp/cache probe read did not match written content");
    }

    return tempDir;
  } catch (error) {
    throw environmentBlocked(
      "environment_blocked_tempdir",
      `Browser harness smoke could not create a writable temp/cache location under ${tempRoot}.`,
      error,
    );
  }
}

async function startSmokeServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(BROWSER_HARNESS_SMOKE_RESPONSE_TEXT);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await closeServer(server);
    throw environmentBlocked(
      "environment_blocked_loopback",
      "Browser harness smoke could not bind a local HTTP server on 127.0.0.1.",
      error,
    );
  }

  const address = server.address();
  if (typeof address === "string" || address === null) {
    await closeServer(server);
    throw environmentBlocked(
      "environment_blocked_loopback",
      "Browser harness smoke did not receive a TCP port for the local HTTP server.",
    );
  }

  return {
    port: address.port,
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function bindSmokeServer(startServer: StartSmokeServer | undefined) {
  try {
    return await (startServer ?? startSmokeServer)();
  } catch (error) {
    if (isEnvironmentBlockedError(error)) {
      throw error;
    }

    throw environmentBlocked(
      "environment_blocked_loopback",
      "Browser harness smoke could not bind a local HTTP server on 127.0.0.1.",
      error,
    );
  }
}

async function launchSmokeBrowser(
  launchChromium: LaunchChromium | undefined,
  timeoutMs: number,
) {
  try {
    if (launchChromium) {
      return await launchChromium({
        headless: true,
        timeout: timeoutMs,
      });
    }

    return await chromium.launch({
      headless: true,
      timeout: timeoutMs,
    });
  } catch (error) {
    throw environmentBlocked(
      "environment_blocked_browser_launch",
      "Playwright Chromium could not launch headless. This environment requires a privileged browser runner or CI job with Chromium OS capabilities.",
      error,
    );
  }
}

async function readSmokePage(
  browser: Pick<Browser, "newPage">,
  url: string,
  timeoutMs: number,
) {
  let page: Pick<Page, "goto" | "locator">;

  try {
    page = await browser.newPage();
  } catch (error) {
    throw environmentBlocked(
      "environment_blocked_browser_launch",
      "Playwright Chromium launched but could not create a page. This environment requires a privileged browser runner or CI job with Chromium OS capabilities.",
      error,
    );
  }

  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    const responseText = await page.locator("body").innerText({
      timeout: timeoutMs,
    });

    if (responseText.trim() !== BROWSER_HARNESS_SMOKE_RESPONSE_TEXT) {
      throw new Error(
        `Smoke page response mismatch: expected ${BROWSER_HARNESS_SMOKE_RESPONSE_TEXT}, received ${responseText}`,
      );
    }

    return responseText;
  } catch (error) {
    throw environmentBlocked(
      "environment_blocked_browser_navigation",
      "Playwright Chromium launched but could not navigate to or read from the local smoke server.",
      error,
    );
  }
}

async function closeSmokeBrowser(
  browser: Pick<Browser, "close">,
  timeoutMs: number,
) {
  try {
    await withTimeout(
      browser.close(),
      timeoutMs,
      "Timed out while closing Playwright Chromium",
    );
  } catch (error) {
    throw environmentBlocked(
      "environment_blocked_browser_launch",
      "Playwright Chromium launched but did not close cleanly. This environment requires a privileged browser runner or CI job with Chromium OS capabilities.",
      error,
    );
  }
}

function environmentBlocked(
  code: EnvironmentBlockedErrorCode,
  message: string,
  cause?: unknown,
): HarnessError & { code: EnvironmentBlockedErrorCode } {
  const causeSummary = summarizeCause(cause);
  const fullMessage = causeSummary
    ? `${message} Cause: ${causeSummary}`
    : message;

  return new HarnessError(code, fullMessage, { cause }) as HarnessError & {
    code: EnvironmentBlockedErrorCode;
  };
}

function toEnvironmentBlockedError(
  error: unknown,
): HarnessError & { code: EnvironmentBlockedErrorCode } {
  if (isEnvironmentBlockedError(error)) {
    return error;
  }

  return environmentBlocked(
    "environment_blocked_browser_launch",
    "Browser harness smoke failed before the environment capability check could complete.",
    error,
  );
}

function summarizeCause(cause: unknown) {
  if (cause === undefined) {
    return undefined;
  }

  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const lines = rawMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = lines.slice(0, 12).join(" ");
  return summary.length > 2_000 ? `${summary.slice(0, 2_000)}...` : summary;
}

async function closeServer(server: Server | undefined) {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function closeBrowserAfterFailure(
  browser: Pick<Browser, "close"> | undefined,
  timeoutMs: number,
) {
  if (!browser) {
    return;
  }

  await withTimeout(
    browser.close(),
    timeoutMs,
    "Timed out while cleaning up Playwright Chromium",
  ).catch(() => undefined);
}

async function removeTempDir(tempDir: string | undefined) {
  if (!tempDir) {
    return;
  }

  await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
