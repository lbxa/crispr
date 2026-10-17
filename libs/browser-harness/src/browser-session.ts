import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import { resolveAppUrl } from "./config";
import { BrowserCdpSession } from "./cdp-session";
import { ConsoleRecorder } from "./console-recorder";
import { HarnessError, toHarnessError } from "./errors";
import { EvidenceWriter } from "./evidence";
import { NetworkRecorder } from "./network-recorder";
import { emitHarnessEvent, redactUrl } from "./observability";
import type {
  BrowserHarnessConfig,
  ScreenshotInput,
  SnapshotResult,
} from "./types";

const BROWSER_LAUNCH_MAX_ATTEMPTS = 2;
type LaunchBrowser = typeof chromium.launch;

export class BrowserSession {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private stopRequested = false;
  private readonly cdp = new BrowserCdpSession();
  private readonly consoleRecorder: ConsoleRecorder;
  private readonly networkRecorder: NetworkRecorder;
  private readonly evidence: EvidenceWriter;

  constructor(
    private readonly config: BrowserHarnessConfig,
    private readonly launchBrowser: LaunchBrowser = chromium.launch.bind(
      chromium,
    ),
  ) {
    this.evidence = new EvidenceWriter(config.evidenceDir);
    this.consoleRecorder = new ConsoleRecorder({
      consoleMessage: (entry) => {
        emitHarnessEvent(
          this.config,
          entry.level === "error"
            ? "browser_console_error"
            : "browser_console_message",
          {
            browser_console_level: entry.level,
            column_number: entry.location?.columnNumber,
            line_number: entry.location?.lineNumber,
            surface: "browser",
            text: entry.text,
            url: entry.location?.url
              ? redactUrl(entry.location.url)
              : undefined,
          },
          entry.level === "error" ? "error" : "info",
        );
      },
      pageError: (entry, error) => {
        emitHarnessEvent(
          this.config,
          "browser_page_error",
          {
            err: error,
            error_message: entry.message,
            error_type: entry.name,
            surface: "browser",
          },
          "error",
        );
      },
    });
    this.networkRecorder = new NetworkRecorder({
      networkFailure: (entry) => {
        emitHarnessEvent(
          this.config,
          entry.status && entry.status >= 400
            ? "browser_http_error"
            : "browser_network_failure",
          {
            error_message: entry.error,
            method: entry.method,
            status: entry.status,
            status_text: entry.statusText,
            surface: "browser",
            url: redactUrl(entry.url),
          },
          "error",
        );
      },
    });
  }

  async start() {
    this.stopRequested = false;
    let lastError: HarnessError | undefined;

    for (
      let attempt = 1;
      attempt <= BROWSER_LAUNCH_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const browser = await this.launchBrowser({
          headless: this.config.headless,
        });
        this.browser = browser;
        this.throwIfStopRequested();

        const context = await browser.newContext({
          baseURL: this.config.appUrl,
          viewport: this.config.viewport,
        });
        this.context = context;
        this.throwIfStopRequested();

        const page = await context.newPage();
        this.page = page;
        this.throwIfStopRequested();

        this.consoleRecorder.attach(page);
        this.networkRecorder.attach(page);
        await this.cdp.attach(page);
        this.throwIfStopRequested();
        await this.open("/");
        this.throwIfStopRequested();
        emitHarnessEvent(this.config, "browser_session_started", {
          app_url: this.config.appUrl,
        });
        return;
      } catch (error) {
        const harnessError = toHarnessError(error, "browser_launch_failed");
        lastError = harnessError;
        await this.closeResources().catch(() => undefined);

        if (this.stopRequested) {
          throw browserStartupCancelledError();
        }

        if (
          harnessError.code === "browser_launch_failed" &&
          attempt < BROWSER_LAUNCH_MAX_ATTEMPTS
        ) {
          emitHarnessEvent(
            this.config,
            "browser_launch_retrying",
            {
              attempt,
              error_message: harnessError.message,
              max_attempts: BROWSER_LAUNCH_MAX_ATTEMPTS,
              outcome: "retrying",
            },
            "warn",
          );
          continue;
        }

        throw harnessError;
      }
    }

    throw (
      lastError ??
      new HarnessError("browser_launch_failed", "Browser launch failed")
    );
  }

  async open(url = "/") {
    const page = this.requirePage();
    const resolved = resolveAppUrl(this.config, url);

    try {
      await page.goto(resolved, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throw toHarnessError(error, "page_open_failed");
    }

    const openedUrl = page.url();
    emitHarnessEvent(this.config, "browser_page_opened", {
      url: redactUrl(openedUrl),
    });
    return openedUrl;
  }

  async snapshot(): Promise<SnapshotResult> {
    const page = this.requirePage();
    const body = page.locator("body");
    const visibleText = await body
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    const accessibilityTree = await body
      .ariaSnapshot({ mode: "ai", timeout: 5_000 })
      .catch(() => "");

    const snapshot: SnapshotResult = {
      accessibilityTree,
      consoleErrors: this.consoleRecorder.errors(),
      failedRequests: this.networkRecorder.failedRequests(),
      pageErrors: this.consoleRecorder.pageErrorEntries(),
      runtimeExceptions: this.cdp.runtimeExceptions(),
      success: true,
      title: await page.title(),
      url: page.url(),
      visibleText,
    };

    await this.writeFinalEvidence(snapshot);
    emitHarnessEvent(this.config, "browser_snapshot_captured", {
      console_error_count: snapshot.consoleErrors.length,
      failed_request_count: snapshot.failedRequests.length,
      page_error_count: snapshot.pageErrors.length,
      runtime_exception_count: snapshot.runtimeExceptions.length,
      surface: "browser",
      url: redactUrl(snapshot.url),
    });
    return snapshot;
  }

  async click(selector: string, timeoutMs?: number) {
    try {
      await this.requirePage().locator(selector).click({ timeout: timeoutMs });
    } catch (error) {
      throw toHarnessError(error, "selector_not_found");
    }
  }

  async type(selector: string, text: string, timeoutMs?: number) {
    try {
      await this.requirePage()
        .locator(selector)
        .fill(text, { timeout: timeoutMs });
    } catch (error) {
      throw toHarnessError(error, "selector_not_found");
    }
  }

  async press(key: string) {
    try {
      await this.requirePage().keyboard.press(key);
    } catch (error) {
      throw toHarnessError(error, "action_timeout");
    }
  }

  async wait(timeoutMs: number) {
    await this.requirePage().waitForTimeout(timeoutMs);
  }

  async waitForText(text: string, timeoutMs = 10_000) {
    await this.requirePage().getByText(text).waitFor({ timeout: timeoutMs });
  }

  async waitForUrl(url: string, timeoutMs = 10_000) {
    await this.requirePage().waitForURL(resolveAppUrl(this.config, url), {
      timeout: timeoutMs,
    });
  }

  async screenshot(input: ScreenshotInput = {}) {
    const path = await this.evidence.screenshotPath(input.name ?? "screenshot");

    try {
      await this.requirePage().screenshot({
        fullPage: input.fullPage,
        path,
      });
    } catch (error) {
      throw toHarnessError(error, "screenshot_failed");
    }

    emitHarnessEvent(this.config, "browser_screenshot_captured", {
      path,
      surface: "browser",
    });
    return path;
  }

  consoleMessages() {
    return this.consoleRecorder.all();
  }

  failedRequests() {
    return this.networkRecorder.failedRequests();
  }

  async writeFinalEvidence(snapshot?: SnapshotResult) {
    const selectedSnapshot = snapshot ?? (await this.snapshot());
    await this.evidence.writeJson("final-snapshot.json", selectedSnapshot);
    await this.evidence.writeJson("console.json", {
      messages: this.consoleRecorder.all(),
      pageErrors: this.consoleRecorder.pageErrorEntries(),
      runtimeExceptions: this.cdp.runtimeExceptions(),
    });
    await this.evidence.writeJson("network.json", {
      failedRequests: this.networkRecorder.failedRequests(),
    });
  }

  async close() {
    this.stopRequested = true;
    await this.closeResources();
  }

  private async closeResources() {
    const context = this.context;
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;

    await this.cdp.detach();
    await context?.close();
    await browser?.close();
    emitHarnessEvent(this.config, "browser_session_closed");
  }

  private throwIfStopRequested() {
    if (this.stopRequested) {
      throw browserStartupCancelledError();
    }
  }

  private requirePage() {
    if (!this.page) {
      throw new HarnessError(
        "browser_not_started",
        "Browser session has not been started",
      );
    }

    return this.page;
  }
}

function browserStartupCancelledError() {
  return new HarnessError(
    "browser_launch_failed",
    "Browser startup was cancelled by a shutdown request",
  );
}
