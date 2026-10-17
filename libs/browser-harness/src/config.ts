import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import YAML from "yaml";
import { z } from "zod";

import { HarnessError } from "./errors";
import type {
  BrowserHarnessConfig,
  BrowserHarnessConfigInput,
  BrowserHarnessRunContext,
} from "./types";

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1000,
};

const fileConfigSchema = z
  .object({
    allow_evaluate: z.boolean().optional(),
    allow_external_urls: z.boolean().optional(),
    allow_raw_cdp: z.boolean().optional(),
    app_name: z.string().optional(),
    app_command: z.string().optional(),
    app_url: z.string().optional(),
    capture_screenshots: z.boolean().optional(),
    capture_video: z.boolean().optional(),
    evidence_dir: z.string().optional(),
    fail_on_console_error: z.boolean().optional(),
    harness_run_id: z.string().optional(),
    headless: z.boolean().optional(),
    issue_id: z.string().optional(),
    issue_identifier: z.string().optional(),
    local_only: z.boolean().optional(),
    persist_browser_state: z.boolean().optional(),
    port: z.number().int().positive().optional(),
    report_network_failures: z.boolean().optional(),
    session_id: z.string().optional(),
    start_app: z.boolean().optional(),
    startup_timeout_ms: z.number().int().positive().optional(),
    task_id: z.string().optional(),
    test_name: z.string().optional(),
    viewport: z
      .object({
        height: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
      })
      .optional(),
    workspace: z.string().optional(),
  })
  .passthrough();

const inputSchema = z.object({
  allowEvaluate: z.boolean().optional(),
  allowExternalUrls: z.boolean().optional(),
  allowRawCdp: z.boolean().optional(),
  appName: z.string().optional(),
  appCommand: z.string().optional(),
  appUrl: z.string().optional(),
  captureScreenshots: z.boolean().optional(),
  captureVideo: z.boolean().optional(),
  configFile: z.string().optional(),
  evidenceDir: z.string().optional(),
  failOnConsoleError: z.boolean().optional(),
  harnessRunId: z.string().optional(),
  headless: z.boolean().optional(),
  issueId: z.string().optional(),
  issueIdentifier: z.string().optional(),
  localOnly: z.boolean().optional(),
  persistBrowserState: z.boolean().optional(),
  port: z.number().int().positive().optional(),
  reportNetworkFailures: z.boolean().optional(),
  sessionId: z.string().optional(),
  startApp: z.boolean().optional(),
  startupTimeoutMs: z.number().int().positive().optional(),
  taskId: z.string().optional(),
  testName: z.string().optional(),
  viewport: z
    .object({
      height: z.number().int().positive().optional(),
      width: z.number().int().positive().optional(),
    })
    .optional(),
  workspace: z.string().optional(),
});

type NormalizedPartialConfig = Omit<BrowserHarnessConfigInput, "configFile">;

export async function loadBrowserHarnessConfig(
  input: BrowserHarnessConfigInput,
): Promise<BrowserHarnessConfig> {
  const parsedInput = parseInput(input);
  const workspaceHint = parsedInput.workspace ?? process.cwd();
  const configFile = parsedInput.configFile
    ? resolve(workspaceHint, parsedInput.configFile)
    : undefined;
  const fileConfig = configFile
    ? await readConfigFile(configFile)
    : ({} satisfies NormalizedPartialConfig);
  const merged = mergeConfig(fileConfig, parsedInput);

  const workspace = resolve(merged.workspace ?? process.cwd());
  await assertWorkspace(workspace);

  const port = merged.port;
  const rawAppUrl = merged.appUrl;
  if (!rawAppUrl) {
    throw new HarnessError("invalid_config", "appUrl is required");
  }

  const appUrl = normalizeUrl(expandPort(rawAppUrl, port));
  if (!merged.allowExternalUrls && !isLoopbackUrl(appUrl)) {
    throw new HarnessError(
      "invalid_config",
      "Only loopback URLs are allowed unless allowExternalUrls is true",
    );
  }

  const startApp = merged.startApp ?? true;
  if (startApp && !merged.appCommand) {
    throw new HarnessError(
      "invalid_config",
      "appCommand is required when startApp is true",
    );
  }

  const evidenceDir = resolve(
    workspace,
    merged.evidenceDir ?? ".harness/evidence",
  );
  if (!isInsidePath(workspace, evidenceDir)) {
    throw new HarnessError(
      "invalid_config",
      "Evidence directory must be inside workspace",
    );
  }

  return {
    allowEvaluate: merged.allowEvaluate ?? false,
    allowExternalUrls: merged.allowExternalUrls ?? false,
    allowRawCdp: merged.allowRawCdp ?? false,
    appCommand: merged.appCommand,
    appUrl,
    captureScreenshots: merged.captureScreenshots ?? true,
    captureVideo: merged.captureVideo ?? false,
    evidenceDir,
    failOnConsoleError: merged.failOnConsoleError ?? false,
    headless: merged.headless ?? true,
    localOnly: merged.localOnly ?? true,
    observability: createRunContext(merged, workspace),
    persistBrowserState: merged.persistBrowserState ?? false,
    port,
    reportNetworkFailures: merged.reportNetworkFailures ?? true,
    startApp,
    startupTimeoutMs: merged.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    viewport: {
      height: merged.viewport?.height ?? DEFAULT_VIEWPORT.height,
      width: merged.viewport?.width ?? DEFAULT_VIEWPORT.width,
    },
    workspace,
  };
}

export function resolveAppUrl(config: BrowserHarnessConfig, url = "/") {
  const resolved = new URL(url, config.appUrl).toString();
  if (!config.allowExternalUrls && !isLoopbackUrl(resolved)) {
    throw new HarnessError(
      "page_open_failed",
      "Only loopback URLs are allowed unless allowExternalUrls is true",
    );
  }

  return resolved;
}

function parseInput(input: BrowserHarnessConfigInput) {
  const result = inputSchema.safeParse(input);
  if (!result.success) {
    throw new HarnessError("invalid_config", result.error.message);
  }

  return result.data;
}

async function readConfigFile(path: string): Promise<NormalizedPartialConfig> {
  const contents = await readFile(path, "utf8");
  const parsed = fileConfigSchema.safeParse(YAML.parse(contents) ?? {});
  if (!parsed.success) {
    throw new HarnessError("invalid_config", parsed.error.message);
  }

  const data = parsed.data;
  return {
    allowEvaluate: data.allow_evaluate,
    allowExternalUrls: data.allow_external_urls,
    allowRawCdp: data.allow_raw_cdp,
    appName: data.app_name,
    appCommand: data.app_command,
    appUrl: data.app_url,
    captureScreenshots: data.capture_screenshots,
    captureVideo: data.capture_video,
    evidenceDir: data.evidence_dir,
    failOnConsoleError: data.fail_on_console_error,
    harnessRunId: data.harness_run_id,
    headless: data.headless,
    issueId: data.issue_id,
    issueIdentifier: data.issue_identifier,
    localOnly: data.local_only,
    persistBrowserState: data.persist_browser_state,
    port: data.port,
    reportNetworkFailures: data.report_network_failures,
    sessionId: data.session_id,
    startApp: data.start_app,
    startupTimeoutMs: data.startup_timeout_ms,
    taskId: data.task_id,
    testName: data.test_name,
    viewport: data.viewport,
    workspace: data.workspace,
  };
}

function createRunContext(
  config: NormalizedPartialConfig,
  workspace: string,
): BrowserHarnessRunContext {
  return {
    appName: nonEmptyString(config.appName) ?? envString("APP_NAME") ?? "web",
    branch:
      envString("BRANCH") ??
      envString("GIT_BRANCH") ??
      gitValue(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]),
    browserSessionId: envString("BROWSER_SESSION_ID") ?? randomUUID(),
    commitSha:
      envString("COMMIT_SHA") ??
      envString("GIT_COMMIT") ??
      gitValue(workspace, ["rev-parse", "--short=12", "HEAD"]),
    harnessRunId:
      nonEmptyString(config.harnessRunId) ??
      envString("HARNESS_RUN_ID") ??
      randomUUID(),
    issueId:
      nonEmptyString(config.issueId) ??
      envString("ISSUE_ID") ??
      envString("LINEAR_ISSUE_ID"),
    issueIdentifier:
      nonEmptyString(config.issueIdentifier) ??
      envString("ISSUE_IDENTIFIER") ??
      envString("LINEAR_ISSUE_IDENTIFIER"),
    sessionId: nonEmptyString(config.sessionId) ?? sessionIdFromEnv(),
    taskId: nonEmptyString(config.taskId) ?? envString("TASK_ID"),
    testName:
      nonEmptyString(config.testName) ??
      envString("TEST_NAME") ??
      "browser_harness",
  };
}

function sessionIdFromEnv(): string | undefined {
  const explicit = envString("SESSION_ID") ?? envString("CODEX_SESSION_ID");
  if (explicit) {
    return explicit;
  }

  const threadId = envString("CODEX_THREAD_ID");
  const turnId = envString("CODEX_TURN_ID");
  return threadId && turnId ? `${threadId}:${turnId}` : undefined;
}

function gitValue(workspace: string, args: string[]) {
  try {
    const value = execFileSync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return nonEmptyString(value);
  } catch {
    return undefined;
  }
}

function envString(name: string) {
  return nonEmptyString(process.env[name]);
}

function nonEmptyString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mergeConfig(
  fileConfig: NormalizedPartialConfig,
  input: BrowserHarnessConfigInput,
): NormalizedPartialConfig {
  return {
    ...fileConfig,
    ...definedOnly(input),
    viewport: {
      ...fileConfig.viewport,
      ...definedOnly(input.viewport ?? {}),
    },
  };
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

async function assertWorkspace(workspace: string) {
  try {
    await access(workspace);
  } catch (error) {
    throw new HarnessError(
      "workspace_not_found",
      `Workspace not found: ${workspace}`,
      { cause: error },
    );
  }
}

function expandPort(value: string, port: number | undefined) {
  const selectedPort = port ?? process.env.PORT;
  return value.replaceAll("${PORT}", selectedPort ? String(selectedPort) : "");
}

function normalizeUrl(value: string) {
  try {
    return new URL(value).toString();
  } catch (error) {
    throw new HarnessError("invalid_config", `Invalid appUrl: ${value}`, {
      cause: error,
    });
  }
}

function isLoopbackUrl(value: string) {
  const url = new URL(value);
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

function isInsidePath(parent: string, child: string) {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(normalizedParent);
}
