import { BrowserHarnessRuntime } from "./browser-harness-runtime";
import { loadBrowserHarnessConfig } from "./config";
import type { BrowserHarnessConfigInput, BrowserHarness } from "./types";

export async function createBrowserHarness(
  input: BrowserHarnessConfigInput,
): Promise<BrowserHarness> {
  const config = await loadBrowserHarnessConfig(input);
  return new BrowserHarnessRuntime(config);
}

export { HarnessError } from "./errors";
export {
  isEnvironmentBlockedCode,
  isEnvironmentBlockedError,
  runBrowserHarnessEnvironmentSmoke,
} from "./environment-smoke";
export type {
  BrowserHarnessEnvironmentSmokeOptions,
  BrowserHarnessEnvironmentSmokeResult,
} from "./environment-smoke";
export { loadBrowserHarnessConfig } from "./config";
export {
  ObservabilityClient,
  createLokiRunQuery,
} from "./observability-client";
export type {
  BrowserHarness,
  BrowserHarnessConfig,
  BrowserHarnessConfigInput,
  BrowserToolResult,
  ConsoleEntry,
  EnvironmentBlockedErrorCode,
  HarnessErrorCode,
  JsonRpcRequest,
  JsonRpcResponse,
  NetworkEntry,
  PageErrorEntry,
  SnapshotResult,
} from "./types";
