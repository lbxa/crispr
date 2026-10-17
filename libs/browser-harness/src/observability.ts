import {
  configureOnceFromEnv,
  getLogger,
  withContext,
  type LogLevel,
  type TelemetryFields,
} from "@crispr/observability";

import type { BrowserHarnessConfig, BrowserHarnessRunContext } from "./types";

type HarnessLogLevel = Extract<LogLevel, "debug" | "info" | "warn" | "error">;

let configured = false;

export function harnessRunContextEnv(
  context: BrowserHarnessRunContext,
): Record<string, string> {
  return definedStrings({
    APP_NAME: context.appName,
    BRANCH: context.branch,
    BROWSER_SESSION_ID: context.browserSessionId,
    COMMIT_SHA: context.commitSha,
    HARNESS_RUN_ID: context.harnessRunId,
    ISSUE_ID: context.issueId,
    ISSUE_IDENTIFIER: context.issueIdentifier,
    SESSION_ID: context.sessionId,
    TASK_ID: context.taskId,
    TEST_NAME: context.testName,
  });
}

export function emitHarnessEvent(
  config: BrowserHarnessConfig,
  eventName: string,
  fields: TelemetryFields = {},
  level: HarnessLogLevel = "info",
): void {
  configureHarnessObservability();
  const logger = getLogger("browser-harness");
  const outcome = fields.outcome ?? inferOutcome(eventName, level);
  const payload = {
    "event.name": eventName,
    surface: "harness",
    ...fields,
    ...(outcome ? { outcome } : {}),
  };
  const message = formatEventMessage(eventName, config.observability, payload);

  withContext(runContextFields(config.observability), () => {
    switch (level) {
      case "debug":
        logger.debug(payload, message);
        break;
      case "warn":
        logger.warn(payload, message);
        break;
      case "error":
        logger.error(payload, message);
        break;
      case "info":
        logger.info(payload, message);
        break;
    }
  });
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function configureHarnessObservability(): void {
  if (configured) {
    return;
  }

  configureOnceFromEnv("browser-harness", { consoleFormat: "none" });
  configured = true;
}

function runContextFields(context: BrowserHarnessRunContext): TelemetryFields {
  return {
    app_name: context.appName,
    branch: context.branch,
    browser_session_id: context.browserSessionId,
    commit_sha: context.commitSha,
    harness_run_id: context.harnessRunId,
    issue_id: context.issueId,
    issue_identifier: context.issueIdentifier,
    session_id: context.sessionId,
    task_id: context.taskId,
    test_name: context.testName,
  };
}

function inferOutcome(
  eventName: string,
  level: HarnessLogLevel,
): string | undefined {
  if (
    level === "error" ||
    eventName.endsWith("_failed") ||
    eventName.endsWith("_failure") ||
    eventName.endsWith("_error")
  ) {
    return "failed";
  }
  if (eventName.endsWith("_started")) {
    return "started";
  }
  if (
    eventName.endsWith("_attached") ||
    eventName.endsWith("_captured") ||
    eventName.endsWith("_closed") ||
    eventName.endsWith("_opened") ||
    eventName.endsWith("_stopped")
  ) {
    return "completed";
  }
  return undefined;
}

function formatEventMessage(
  eventName: string,
  context: BrowserHarnessRunContext,
  fields: TelemetryFields,
): string {
  const parts = [
    eventName,
    keyValue("outcome", fields.outcome),
    keyValue("harness_run_id", context.harnessRunId),
    keyValue("issue_id", context.issueId),
    keyValue("issue_identifier", context.issueIdentifier),
    keyValue("session_id", context.sessionId),
    keyValue("reason", fields.reason ?? fields.error_message),
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function keyValue(key: string, value: unknown): string | undefined {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  return `${key}=${String(value)}`;
}

function definedStrings(
  fields: Record<string, string | undefined>,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) {
      selected[key] = value;
    }
  }
  return selected;
}
