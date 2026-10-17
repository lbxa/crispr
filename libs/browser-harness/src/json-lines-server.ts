import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";

import { HarnessError } from "./errors";
import { runBrowserTool } from "./tools";
import type { BrowserHarness, JsonRpcResponse } from "./types";

const jsonRpcRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});

type ProcessSignal = "SIGINT" | "SIGTERM";

type SignalSource = {
  off(signal: ProcessSignal, listener: () => void): void;
  on(signal: ProcessSignal, listener: () => void): void;
};

export type JsonLinesServerOptions = {
  input: Readable;
  output: Writable;
  signalSource?: SignalSource;
};

export type JsonLinesServerResult = {
  exitCode: 0 | 130 | 143;
};

export async function serveBrowserJsonLines(
  harness: BrowserHarness,
  options: JsonLinesServerOptions,
): Promise<JsonLinesServerResult> {
  const lines = createInterface({
    crlfDelay: Infinity,
    input: options.input,
    terminal: false,
  });
  let closedByTool = false;
  let requestedSignal: ProcessSignal | undefined;
  let stopPromise: Promise<void> | undefined;
  let resolveSignal: (() => void) | undefined;
  const signalRequested = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });

  const stopOnce = () => {
    stopPromise ??= harness.stop();
    return stopPromise;
  };
  const requestSignal = (signal: ProcessSignal) => {
    if (requestedSignal) {
      return;
    }
    requestedSignal = signal;
    lines.close();
    resolveSignal?.();
  };
  const onSigint = () => requestSignal("SIGINT");
  const onSigterm = () => requestSignal("SIGTERM");

  options.signalSource?.on("SIGINT", onSigint);
  options.signalSource?.on("SIGTERM", onSigterm);

  try {
    const startPromise = harness.start();
    const startOutcome = await Promise.race([
      startPromise.then(() => "started" as const),
      signalRequested.then(() => "signaled" as const),
    ]);

    if (startOutcome === "signaled") {
      void startPromise.catch(() => undefined);
      await stopOnce();
      return { exitCode: signalExitCode(requestedSignal) };
    }

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const linePromise = handleJsonLine(harness, line).then(
        async (response) => {
          await writeJsonLine(options.output, response);
          return response;
        },
      );
      const lineOutcome = await Promise.race([
        linePromise.then(
          (response) => ({ response, type: "response" }) as const,
        ),
        signalRequested.then(() => ({ type: "signaled" }) as const),
      ]);

      if (lineOutcome.type === "signaled") {
        void linePromise.catch(() => undefined);
        return { exitCode: signalExitCode(requestedSignal) };
      }

      if (isSuccessfulBrowserClose(line, lineOutcome.response)) {
        closedByTool = true;
        lines.close();
        break;
      }
    }

    return { exitCode: signalExitCode(requestedSignal) };
  } finally {
    lines.close();
    options.signalSource?.off("SIGINT", onSigint);
    options.signalSource?.off("SIGTERM", onSigterm);
    if (!closedByTool) {
      await stopOnce();
    }
  }
}

async function handleJsonLine(
  harness: BrowserHarness,
  line: string,
): Promise<JsonRpcResponse> {
  let parsedLine: unknown;
  try {
    parsedLine = JSON.parse(line);
  } catch {
    return invalidRequest("Invalid JSON request");
  }

  const parsedRequest = jsonRpcRequestSchema.safeParse(parsedLine);
  if (!parsedRequest.success) {
    return invalidRequest("Invalid JSON request shape");
  }

  const request = parsedRequest.data;

  try {
    const result = await runBrowserTool(
      harness,
      request.method,
      request.params ?? {},
    );
    return { id: request.id, result };
  } catch (error) {
    const harnessError =
      error instanceof HarnessError
        ? error
        : new HarnessError("invalid_config", String(error));

    return {
      error: {
        code: harnessError.code,
        message: harnessError.message,
      },
      id: request.id,
    };
  }
}

function invalidRequest(message: string): JsonRpcResponse {
  return {
    error: { code: "invalid_config", message },
    id: "",
  };
}

function isSuccessfulBrowserClose(line: string, response: JsonRpcResponse) {
  if ("error" in response) {
    return false;
  }

  try {
    const parsedRequest = jsonRpcRequestSchema.safeParse(JSON.parse(line));
    return (
      parsedRequest.success && parsedRequest.data.method === "browser.close"
    );
  } catch {
    return false;
  }
}

async function writeJsonLine(output: Writable, response: JsonRpcResponse) {
  if (output.write(`${JSON.stringify(response)}\n`)) {
    return;
  }
  await once(output, "drain");
}

function signalExitCode(signal: ProcessSignal | undefined): 0 | 130 | 143 {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return 0;
}
