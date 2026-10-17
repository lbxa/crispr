import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import treeKill from "tree-kill";

import { HarnessError, toHarnessError } from "./errors";
import { emitHarnessEvent, harnessRunContextEnv } from "./observability";
import type { AppLogEntry, BrowserHarnessConfig } from "./types";

const APP_LOG_BUFFER_CHARACTERS = 64_000;
const STARTUP_LOG_TAIL_CHARACTERS = 4_000;
const READINESS_PROBE_TIMEOUT_MS = 1_000;
const TARGET_PREFLIGHT_TIMEOUT_MS = 1_000;

export class AppProcess {
  private child: ChildProcess | undefined;
  private readonly logs: AppLogEntry[] = [];
  private logCharacters = 0;
  private stopRequested = false;

  constructor(private readonly config: BrowserHarnessConfig) {}

  async start() {
    this.stopRequested = false;
    this.resetLogs();

    try {
      if (!this.config.startApp) {
        await waitForUrl(this.config.appUrl, this.config.startupTimeoutMs);
        emitHarnessEvent(this.config, "app_process_attached", {
          app_url: this.config.appUrl,
        });
        return;
      }

      if (!this.config.appCommand) {
        throw new HarnessError("invalid_config", "appCommand is required");
      }

      await assertTargetUnused(
        this.config.appUrl,
        Math.min(TARGET_PREFLIGHT_TIMEOUT_MS, this.config.startupTimeoutMs),
      );
      this.throwIfStopRequested();

      const child = spawn(this.config.appCommand, {
        cwd: this.config.workspace,
        env: {
          ...process.env,
          ...harnessRunContextEnv(this.config.observability),
          ...(this.config.port ? { PORT: String(this.config.port) } : {}),
        },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      emitHarnessEvent(this.config, "app_process_started", {
        app_url: this.config.appUrl,
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        this.record("stdout", chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        this.record("stderr", chunk);
      });
      if (this.stopRequested) {
        await terminateChild(child);
        throw startupCancelledError();
      }

      const termination = watchStartupTermination(child);
      try {
        await Promise.race([
          waitForUrl(this.config.appUrl, this.config.startupTimeoutMs),
          termination.promise,
        ]);

        if (child.exitCode !== null || child.signalCode !== null) {
          throw childTerminationError(child.exitCode, child.signalCode);
        }
        this.throwIfStopRequested();
      } finally {
        termination.dispose();
      }
    } catch (error) {
      const harnessError = toHarnessError(error, "app_start_failed");
      emitHarnessEvent(
        this.config,
        "app_process_start_failed",
        {
          app_url: this.config.appUrl,
          error_message: harnessError.message,
        },
        "error",
      );
      throw this.withStartupDiagnostics(harnessError);
    }
  }

  appLogs() {
    return [...this.logs];
  }

  async stop() {
    this.stopRequested = true;
    const child = this.child;
    this.child = undefined;

    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await terminateChild(child);

    emitHarnessEvent(this.config, "app_process_stopped");
  }

  private record(stream: "stdout" | "stderr", chunk: Buffer) {
    let text = chunk.toString("utf8");
    if (text.length > APP_LOG_BUFFER_CHARACTERS) {
      text = text.slice(-APP_LOG_BUFFER_CHARACTERS);
      this.logs.length = 0;
      this.logCharacters = 0;
    }

    this.logs.push({
      stream,
      text,
      timestamp: new Date().toISOString(),
    });
    this.logCharacters += text.length;

    while (
      this.logCharacters > APP_LOG_BUFFER_CHARACTERS &&
      this.logs.length > 1
    ) {
      const removed = this.logs.shift();
      this.logCharacters -= removed?.text.length ?? 0;
    }
  }

  private resetLogs() {
    this.logs.length = 0;
    this.logCharacters = 0;
  }

  private withStartupDiagnostics(error: HarnessError) {
    const output = startupLogTail(this.logs);

    if (!output) {
      return error;
    }

    return new HarnessError(
      error.code,
      `${error.message}\nApp output (tail):\n${output}`,
      { cause: error },
    );
  }

  private throwIfStopRequested() {
    if (this.stopRequested) {
      throw startupCancelledError();
    }
  }
}

function startupLogTail(logs: readonly AppLogEntry[]) {
  const output: string[] = [];
  let remaining = STARTUP_LOG_TAIL_CHARACTERS;

  for (let index = logs.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = logs[index];
    if (!entry) {
      continue;
    }

    const label = `[${entry.stream}] `;
    if (remaining <= label.length) {
      break;
    }

    const text = entry.text.slice(-(remaining - label.length));
    const labelledText = `${label}${text}`;
    output.unshift(labelledText);
    remaining -= labelledText.length;
  }

  return output.join("").trim();
}

async function waitForUrl(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let lastStatus: number | undefined;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.min(READINESS_PROBE_TIMEOUT_MS, remainingMs),
        ),
      });
      lastStatus = response.status;
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    const delayMs = Math.min(250, Math.max(0, deadline - Date.now()));
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const lastObservation =
    lastStatus === undefined ? "" : `; last HTTP status ${lastStatus}`;
  throw new HarnessError(
    "app_start_timeout",
    `Timed out waiting for ${url}${lastObservation}`,
    { cause: lastError },
  );
}

async function assertTargetUnused(url: string, timeoutMs: number) {
  if (!(await isTcpEndpointListening(url, timeoutMs))) {
    return;
  }

  throw new HarnessError(
    "app_start_failed",
    `The target for ${url} is already listening. Choose a free port when starting an app, or use startApp=false to attach to the existing service.`,
  );
}

async function isTcpEndpointListening(url: string, timeoutMs: number) {
  const target = new URL(url);
  const port = target.port
    ? Number(target.port)
    : target.protocol === "https:"
      ? 443
      : 80;

  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: target.hostname, port });
    let settled = false;

    const finish = (listening: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function watchStartupTermination(child: ChildProcess) {
  let onError: ((error: Error) => void) | undefined;
  let onClose:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  const promise = new Promise<never>((_resolve, reject) => {
    let settled = false;
    const fail = (error: HarnessError) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    onError = (error) => {
      fail(
        new HarnessError("app_start_failed", error.message, { cause: error }),
      );
    };
    onClose = (code, signal) => {
      fail(childTerminationError(code, signal));
    };

    child.once("error", onError);
    child.once("close", onClose);
  });

  return {
    dispose() {
      if (onError) {
        child.off("error", onError);
      }
      if (onClose) {
        child.off("close", onClose);
      }
    },
    promise,
  };
}

function childTerminationError(
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  const outcome =
    code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
  return new HarnessError(
    "app_start_failed",
    `App process exited before startup with ${outcome}`,
  );
}

function startupCancelledError() {
  return new HarnessError(
    "app_start_failed",
    "App startup was cancelled by a shutdown request",
  );
}

async function terminateChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    treeKill(child.pid!, "SIGTERM", (error) => {
      if (error) {
        reject(
          new HarnessError("shutdown_failed", error.message, {
            cause: error,
          }),
        );
        return;
      }

      resolve();
    });
  });
}
