import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { serveBrowserJsonLines } from "./json-lines-server";
import type { BrowserHarness } from "./types";

function createHarnessStub(
  calls: string[],
  overrides: {
    start?: () => Promise<void>;
    wait?: () => Promise<void>;
  } = {},
): BrowserHarness {
  const success = async () => ({ success: true }) as const;

  return {
    async click() {
      return success();
    },
    async close() {
      calls.push("close");
      return success();
    },
    async console() {
      return { messages: [], success: true };
    },
    async network() {
      return { failedRequests: [], success: true };
    },
    async open() {
      return { success: true, url: "http://127.0.0.1:3000/" };
    },
    async press() {
      return success();
    },
    async pointer() {
      return success();
    },
    async screenshot() {
      return { path: "/tmp/screenshot.png", success: true };
    },
    async snapshot() {
      return {
        accessibilityTree: "",
        consoleErrors: [],
        failedRequests: [],
        pageErrors: [],
        runtimeExceptions: [],
        success: true,
        title: "",
        url: "http://127.0.0.1:3000/",
        visibleText: "",
      };
    },
    async start() {
      calls.push("start");
      await overrides.start?.();
    },
    async stop() {
      calls.push("stop");
    },
    async type() {
      return success();
    },
    async setInputFiles() {
      return success();
    },
    async wait() {
      calls.push("wait");
      await overrides.wait?.();
      return success();
    },
    async waitForText() {
      return { matched: true, success: true };
    },
    async waitForUrl() {
      return success();
    },
  };
}

function collectOutput(stream: PassThrough) {
  let value = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    value += chunk;
  });
  return () => value;
}

async function settleWithin(
  promise: Promise<unknown>,
  diagnostics: () => unknown,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `JSONL server did not settle: ${JSON.stringify(diagnostics())}`,
            ),
          );
        }, 500);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

describe("serveBrowserJsonLines", () => {
  test("browser.close ends the session without waiting for stdin EOF", async () => {
    // Arrange
    const calls: string[] = [];
    const harness = createHarnessStub(calls);
    const input = new PassThrough();
    const output = new PassThrough();
    const outputText = collectOutput(output);
    const serving = serveBrowserJsonLines(harness, { input, output });
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Act
    input.write(
      `${JSON.stringify({ id: "close", method: "browser.close", params: {} })}\n`,
    );
    await settleWithin(serving, () => ({ calls, output: outputText() }));

    // Assert
    expect({ calls, responses: outputText().trim().split("\n") }).toEqual({
      calls: ["start", "close"],
      responses: [JSON.stringify({ id: "close", result: { success: true } })],
    });
  });

  test("stdin EOF stops an open harness exactly once", async () => {
    // Arrange
    const calls: string[] = [];
    const harness = createHarnessStub(calls);
    const input = new PassThrough();
    const output = new PassThrough();
    const serving = serveBrowserJsonLines(harness, { input, output });
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Act
    input.end();
    await settleWithin(serving, () => ({ calls }));

    // Assert
    expect(calls).toEqual(["start", "stop"]);
  });

  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    test(`${signal} stops an active JSONL session exactly once`, async () => {
      // Arrange
      const calls: string[] = [];
      const harness = createHarnessStub(calls);
      const input = new PassThrough();
      const output = new PassThrough();
      const signalSource = new EventEmitter();
      const serving = serveBrowserJsonLines(harness, {
        input,
        output,
        signalSource,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Act
      signalSource.emit(signal);
      const result = await serving;

      // Assert
      expect({
        calls,
        exitCode: result.exitCode,
        remainingListeners: signalSource.listenerCount(signal),
      }).toEqual({ calls: ["start", "stop"], exitCode, remainingListeners: 0 });
    });
  }

  test("a signal during startup requests cleanup without waiting for startup", async () => {
    // Arrange
    const calls: string[] = [];
    const neverReady = new Promise<void>(() => undefined);
    const harness = createHarnessStub(calls, {
      start: () => neverReady,
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const signalSource = new EventEmitter();
    const serving = serveBrowserJsonLines(harness, {
      input,
      output,
      signalSource,
    });

    // Act
    signalSource.emit("SIGINT");
    let result: Awaited<typeof serving> | undefined;
    await settleWithin(
      serving.then((value) => {
        result = value;
      }),
      () => ({ calls }),
    );

    // Assert
    expect({ calls, exitCode: result?.exitCode }).toEqual({
      calls: ["start", "stop"],
      exitCode: 130,
    });
  });

  test("a signal interrupts an in-flight tool call and cleans up", async () => {
    // Arrange
    const calls: string[] = [];
    const neverFinishes = new Promise<void>(() => undefined);
    let markWaitStarted: (() => void) | undefined;
    const waitStarted = new Promise<void>((resolve) => {
      markWaitStarted = resolve;
    });
    const harness = createHarnessStub(calls, {
      wait: async () => {
        markWaitStarted?.();
        await neverFinishes;
      },
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const signalSource = new EventEmitter();
    const serving = serveBrowserJsonLines(harness, {
      input,
      output,
      signalSource,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.write(
      `${JSON.stringify({ id: "wait", method: "browser.wait", params: { timeoutMs: 1 } })}\n`,
    );
    await waitStarted;

    // Act
    signalSource.emit("SIGTERM");
    let result: Awaited<typeof serving> | undefined;
    await settleWithin(
      serving.then((value) => {
        result = value;
      }),
      () => ({ calls }),
    );

    // Assert
    expect({ calls, exitCode: result?.exitCode }).toEqual({
      calls: ["start", "wait", "stop"],
      exitCode: 143,
    });
  });
});
