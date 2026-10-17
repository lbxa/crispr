import { AppProcess } from "./app-process";
import { BrowserSession } from "./browser-session";
import { HarnessError } from "./errors";
import { emitHarnessEvent } from "./observability";
import type {
  BrowserHarness,
  BrowserHarnessConfig,
  ClickInput,
  OpenInput,
  PointerInput,
  PressInput,
  ScreenshotInput,
  SetInputFilesInput,
  TypeInput,
  WaitForTextInput,
  WaitForUrlInput,
  WaitInput,
} from "./types";

export class BrowserHarnessRuntime implements BrowserHarness {
  private started = false;
  private stopping: Promise<void> | undefined;
  private stopRequested = false;

  constructor(
    private readonly config: BrowserHarnessConfig,
    private readonly appProcess: AppProcess = new AppProcess(config),
    private readonly browserSession: BrowserSession = new BrowserSession(
      config,
    ),
  ) {}

  async start() {
    if (this.started) {
      return;
    }

    this.stopRequested = false;
    this.stopping = undefined;
    try {
      emitHarnessEvent(this.config, "browser_harness_run_started", {
        app_url: this.config.appUrl,
      });
      await this.appProcess.start();
      this.throwIfStopRequested();
      await this.browserSession.start();
      this.throwIfStopRequested();
      this.started = true;
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async open(input: OpenInput = {}) {
    const url = await this.browserSession.open(input.url ?? "/");
    return { success: true, url } as const;
  }

  async snapshot() {
    return this.browserSession.snapshot();
  }

  async click(input: ClickInput) {
    await this.browserSession.click(input.selector, input.timeoutMs);
    return { success: true } as const;
  }

  async type(input: TypeInput) {
    await this.browserSession.type(input.selector, input.text, input.timeoutMs);
    return { success: true } as const;
  }

  async press(input: PressInput) {
    await this.browserSession.press(input.key);
    return { success: true } as const;
  }

  async pointer(input: PointerInput) {
    await this.browserSession.pointer(input);
    return { success: true } as const;
  }

  async setInputFiles(input: SetInputFilesInput) {
    await this.browserSession.setInputFiles(input);
    return { success: true } as const;
  }

  async wait(input: WaitInput) {
    await this.browserSession.wait(input.timeoutMs);
    return { success: true } as const;
  }

  async waitForText(input: WaitForTextInput) {
    await this.browserSession.waitForText(input.text, input.timeoutMs);
    return { matched: true, success: true } as const;
  }

  async waitForUrl(input: WaitForUrlInput) {
    await this.browserSession.waitForUrl(input.url, input.timeoutMs);
    return { success: true } as const;
  }

  async screenshot(input: ScreenshotInput = {}) {
    const path = await this.browserSession.screenshot(input);
    return { path, success: true } as const;
  }

  async console() {
    return {
      messages: this.browserSession.consoleMessages(),
      success: true,
    } as const;
  }

  async network() {
    return {
      failedRequests: this.browserSession.failedRequests(),
      success: true,
    } as const;
  }

  async close() {
    await this.stop();
    return { success: true } as const;
  }

  async stop() {
    this.stopRequested = true;
    this.stopping ??= this.stopResources();
    await this.stopping;
  }

  private async stopResources() {
    const shouldWriteEvidence = this.started;
    this.started = false;

    try {
      if (shouldWriteEvidence) {
        await this.browserSession.writeFinalEvidence().catch(() => undefined);
      }
      await this.browserSession.close();
    } finally {
      await this.appProcess.stop();
      emitHarnessEvent(this.config, "browser_harness_run_stopped");
    }
  }

  private throwIfStopRequested() {
    if (this.stopRequested) {
      throw new HarnessError(
        "app_start_failed",
        "Browser harness startup was cancelled by a shutdown request",
      );
    }
  }
}
