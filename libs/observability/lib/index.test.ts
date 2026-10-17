import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configure,
  configureFromEnv,
  configureOnceFromEnv,
  createLokiRunQuery,
  getLevel,
  getLogger,
  getMetrics,
  isConfigured,
  lokiSearchLogs,
  setLevel,
  withContext,
  withSpan,
  __resetForTests,
  type ObservabilityConfig,
} from "./index.ts";

type CapturedWrite = {
  line: string;
};

function createCapture() {
  const writes: CapturedWrite[] = [];
  return {
    writes,
    stream: {
      write(line: string): void {
        writes.push({ line });
      },
    },
    payload(index = 0): Record<string, unknown> {
      const write = writes[index];
      if (!write) {
        throw new Error(`Missing captured log line at index ${index}`);
      }
      return JSON.parse(write.line) as Record<string, unknown>;
    },
  };
}

function baseConfig(
  overrides: Partial<ObservabilityConfig> = {},
): ObservabilityConfig {
  return {
    serviceName: "observability-ts-test",
    environment: "test",
    consoleFormat: "json",
    level: "info",
    exportLogs: false,
    exportTraces: false,
    exportMetrics: false,
    ...overrides,
  };
}

describe("observability-ts", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearTelemetryEnv();
    __resetForTests();
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    clearTelemetryEnv();
    globalThis.fetch = originalFetch;
    await __resetForTests();
  });

  test("pino logger emits the shared JSON contract and mapped aliases", () => {
    const capture = createCapture();
    configure(baseConfig({ destination: capture.stream }));

    getLogger("web").info(
      {
        app_name: "web",
        branch: "codex/observability",
        browser_session_id: "browser-session-1",
        commit_sha: "abc1234",
        operation_id: "operation-1",
        harness_run_id: "run-1",
        issue_id: "issue-uuid-1",
        issue_identifier: "MT-620",
        session_id: "thread-1:turn-1",
        task_id: "task-1",
        test_name: "next_home",
        request_id: "request-1",
        workflow: "agent_iteration",
        optional: null,
      },
      "agent_iteration_completed",
    );

    const payload = capture.payload();
    expect(payload["level"]).toBe("info");
    expect(payload["logger"]).toBe("web");
    expect(payload["message"]).toBe("agent_iteration_completed");
    expect(payload["service_name"]).toBe("observability-ts-test");
    expect(payload["environment"]).toBe("test");
    expect(payload["event.name"]).toBe("agent_iteration_completed");
    expect(payload["app_name"]).toBe("web");
    expect(payload["branch"]).toBe("codex/observability");
    expect(payload["browser_session_id"]).toBe("browser-session-1");
    expect(payload["commit_sha"]).toBe("abc1234");
    expect(payload["operation.id"]).toBe("operation-1");
    expect(payload["harness_run_id"]).toBe("run-1");
    expect(payload["issue_id"]).toBe("issue-uuid-1");
    expect(payload["issue_identifier"]).toBe("MT-620");
    expect(payload["session_id"]).toBe("thread-1:turn-1");
    expect(payload["task_id"]).toBe("task-1");
    expect(payload["test_name"]).toBe("next_home");
    expect(payload["request.id"]).toBe("request-1");
    expect(payload["workflow.name"]).toBe("agent_iteration");
    expect(payload).not.toHaveProperty("optional");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("trace_id");
    expect(payload).toHaveProperty("span_id");
  });

  test("context fields are inherited and explicit log fields take precedence", () => {
    const capture = createCapture();
    configure(baseConfig({ destination: capture.stream }));

    withContext(
      {
        correlation_id: "correlation-1",
        harness_run_id: "run-1",
        request_id: "request-1",
      },
      () => {
        getLogger("web").info(
          { harness_run_id: "run-2" },
          "context_precedence",
        );
      },
    );

    const payload = capture.payload();
    expect(payload["harness_run_id"]).toBe("run-2");
    expect(payload["correlation.id"]).toBe("correlation-1");
    expect(payload["request.id"]).toBe("request-1");
  });

  test("harness environment fields are attached to telemetry", () => {
    const capture = createCapture();
    process.env.APP_NAME = "web";
    process.env.BRANCH = "codex/observability";
    process.env.BROWSER_SESSION_ID = "browser-session-1";
    process.env.COMMIT_SHA = "abc1234";
    process.env.HARNESS_RUN_ID = "run-1";
    process.env.ISSUE_ID = "issue-uuid-1";
    process.env.ISSUE_IDENTIFIER = "MT-620";
    process.env.SESSION_ID = "thread-1:turn-1";
    process.env.TASK_ID = "task-1";
    process.env.TEST_NAME = "next_home";
    configure(baseConfig({ destination: capture.stream }));

    getLogger("web").info("environment_context");

    const payload = capture.payload();
    expect(payload["app_name"]).toBe("web");
    expect(payload["branch"]).toBe("codex/observability");
    expect(payload["browser_session_id"]).toBe("browser-session-1");
    expect(payload["commit_sha"]).toBe("abc1234");
    expect(payload["harness_run_id"]).toBe("run-1");
    expect(payload["issue_id"]).toBe("issue-uuid-1");
    expect(payload["issue_identifier"]).toBe("MT-620");
    expect(payload["session_id"]).toBe("thread-1:turn-1");
    expect(payload["task_id"]).toBe("task-1");
    expect(payload["test_name"]).toBe("next_home");
  });

  test("Codex thread and turn ids compose the session id when explicit id is absent", () => {
    const capture = createCapture();
    process.env.CODEX_THREAD_ID = "thread-1";
    process.env.CODEX_TURN_ID = "turn-1";
    configure(baseConfig({ destination: capture.stream }));

    getLogger("web").info("codex_session_context");

    expect(capture.payload()["session_id"]).toBe("thread-1:turn-1");
  });

  test("errors attach canonical error fields", () => {
    const capture = createCapture();
    configure(baseConfig({ destination: capture.stream }));

    getLogger("web").error(
      { err: new TypeError("boom") },
      "agent_iteration_failed",
    );

    const payload = capture.payload();
    expect(payload["event.name"]).toBe("agent_iteration_failed");
    expect(payload["error.type"]).toBe("TypeError");
    expect(payload["error.message"]).toBe("boom");
    expect(String(payload["error.stack"])).toContain("TypeError: boom");
  });

  test("log level can be updated at runtime", () => {
    const capture = createCapture();
    configure(baseConfig({ destination: capture.stream }));

    getLogger("web").debug("debug_suppressed");
    setLevel("debug");
    getLogger("web").debug("debug_enabled");

    expect(getLevel()).toBe("debug");
    expect(capture.writes).toHaveLength(1);
    expect(capture.payload()["event.name"]).toBe("debug_enabled");
  });

  test("configureFromEnv reads the shared environment contract", () => {
    const capture = createCapture();
    process.env.ENVIRONMENT = "production";
    process.env.OBSERVABILITY_LOG_LEVEL = "warn";
    process.env.OBSERVABILITY_CONSOLE_FORMAT = "plain";
    process.env.OTEL_METRIC_EXPORT_INTERVAL_MILLIS = "2500";

    const guard = configureFromEnv("web", { destination: capture.stream });

    expect(guard.config.serviceName).toBe("web");
    expect(guard.config.environment).toBe("production");
    expect(guard.config.level).toBe("warn");
    expect(guard.config.consoleFormat).toBe("plain");
    expect(guard.config.metricExportIntervalMillis).toBe(2500);
  });

  test("console format none suppresses console writes", () => {
    const capture = createCapture();
    configure(
      baseConfig({ consoleFormat: "none", destination: capture.stream }),
    );

    getLogger("catalogue").info(
      { request_id: "request-1" },
      "hidden_from_console",
    );

    expect(capture.writes).toHaveLength(0);
  });

  test("configureFromEnv accepts console format none", () => {
    process.env.OBSERVABILITY_CONSOLE_FORMAT = "none";

    const guard = configureFromEnv("browser-harness");

    expect(guard.config.consoleFormat).toBe("none");
  });

  test("configureOnceFromEnv does not reconfigure an active process", () => {
    const first = configureOnceFromEnv("browser-harness");
    const second = configureOnceFromEnv("web");

    expect(isConfigured()).toBe(true);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.guard).toBe(first.guard);
    expect(second.guard.config.serviceName).toBe("browser-harness");
  });

  test("spans and metrics are usable without an exporter", async () => {
    configure(baseConfig());
    const metrics = getMetrics("observability-ts-tests");

    await withSpan("unit_test_span", { operation_id: "op-1" }, async () => {
      metrics.increment("unit_test_counter_total", 1, { outcome: "success" });
      metrics.record("unit_test_duration_ms", 12.5, {
        unit: "ms",
        outcome: "success",
      });
    });

    expect(true).toBe(true);
  });

  test("configure is process-wide and shutdown is idempotent", async () => {
    const guard = configure(baseConfig());

    expect(() => configure(baseConfig())).toThrow(
      "Observability is already configured",
    );

    await guard.shutdown();
    await guard.shutdown();
  });

  test("searches Loki with generated service, contains, and level filters", async () => {
    const calls = captureFetchCalls({
      status: "success",
      data: {
        resultType: "streams",
        result: [],
      },
    });

    const result = await lokiSearchLogs({
      contains: "issue_identifier=MT-620",
      level: "error",
      service: "web",
    });

    const url = new URL(String(calls[0]?.url));
    expect(result.success).toBe(true);
    expect(result.query).toBe(
      '{service_name="web"} |= "issue_identifier=MT-620" | json | level="error"',
    );
    expect(url.origin).toBe("http://127.0.0.1:3100");
    expect(url.pathname).toBe("/loki/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe(result.query);
    expect(url.searchParams.get("since")).toBe("15m");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("direction")).toBe("backward");
  });

  test("builds a run-scoped Loki query for harness evidence", () => {
    expect(
      createLokiRunQuery("run-1", {
        eventName: /^browser_console_/,
        level: "error",
        surface: "browser",
      }),
    ).toBe(
      '{service_name=~".+"} | harness_run_id="run-1" | level="error" | surface="browser" | event_name=~"^browser_console_"',
    );
  });

  test("uses raw LogQL and clamps the query limit", async () => {
    const calls = captureFetchCalls({
      status: "success",
      data: {
        resultType: "streams",
        result: [],
      },
    });

    const result = await lokiSearchLogs({
      limit: 5000,
      query: '{service_name=~".+"} | issue_identifier="MT-620"',
      since: "2h",
    });

    const url = new URL(String(calls[0]?.url));
    expect(result.success).toBe(true);
    expect(result.query).toBe(
      '{service_name=~".+"} | issue_identifier="MT-620"',
    );
    expect(result.limit).toBe(1000);
    expect(result.since).toBe("2h");
    expect(url.searchParams.get("limit")).toBe("1000");
  });

  test("sends tenant headers and custom Loki URL from environment", async () => {
    process.env.LOKI_URL = "http://loki:3100";
    process.env.LOKI_TENANT = "Tenant1";
    const calls = captureFetchCalls({
      status: "success",
      data: {
        resultType: "streams",
        result: [],
      },
    });

    await lokiSearchLogs({ query: '{service_name="web"}' });

    const url = new URL(String(calls[0]?.url));
    expect(url.origin).toBe("http://loki:3100");
    expect(calls[0]?.headers.get("X-Scope-OrgID")).toBe("Tenant1");
  });

  test("flattens Loki stream results with ISO timestamps and truncated lines", async () => {
    const longLine = "x".repeat(2050);
    captureFetchCalls({
      status: "success",
      data: {
        resultType: "streams",
        result: [
          {
            stream: {
              service_name: "web",
            },
            values: [["1569266497240578000", longLine]],
          },
        ],
      },
    });

    const result = await lokiSearchLogs({ query: '{service_name="web"}' });

    expect(result.success).toBe(true);
    expect(result.entries).toEqual([
      {
        labels: {
          service_name: "web",
        },
        line: "x".repeat(2048),
        ts: "2019-09-23T19:21:37.240Z",
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  test("returns structured errors for Loki HTTP failures", async () => {
    captureFetchCalls(
      { message: "bad query" },
      {
        status: 400,
      },
    );

    const result = await lokiSearchLogs({ query: "bad" });

    expect(result).toEqual({
      body: JSON.stringify({ message: "bad query" }),
      error: "loki_http_400",
      success: false,
    });
  });

  test("returns structured errors for fetch failures", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection refused");
    };

    const result = await lokiSearchLogs({ query: '{service_name="web"}' });

    expect(result.success).toBe(false);
    expect(result.error).toBe("loki_fetch_failed");
    expect(result.body).toBe("connection refused");
  });

  test("returns structured errors for malformed Loki responses", async () => {
    captureFetchCalls({
      status: "success",
      data: {
        resultType: "streams",
        result: [
          {
            stream: {
              service_name: "web",
            },
            values: [["not-nanoseconds", "line"]],
          },
        ],
      },
    });

    const result = await lokiSearchLogs({ query: '{service_name="web"}' });

    expect(result.success).toBe(false);
    expect(result.error).toBe("loki_invalid_response");
  });
});

function clearTelemetryEnv(): void {
  for (const name of [
    "APP_NAME",
    "BRANCH",
    "BROWSER_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CODEX_TURN_ID",
    "COMMIT_SHA",
    "ENVIRONMENT",
    "HARNESS_RUN_ID",
    "ISSUE_ID",
    "ISSUE_IDENTIFIER",
    "LINEAR_ISSUE_ID",
    "LINEAR_ISSUE_IDENTIFIER",
    "LOKI_TENANT",
    "LOKI_URL",
    "OBSERVABILITY_CONSOLE_FORMAT",
    "OBSERVABILITY_LOG_LEVEL",
    "OTEL_METRIC_EXPORT_INTERVAL_MILLIS",
    "SESSION_ID",
    "TASK_ID",
    "TEST_NAME",
  ]) {
    delete process.env[name];
  }
}

type FetchCall = {
  headers: Headers;
  url: string;
};

function captureFetchCalls(
  body: unknown,
  init: ResponseInit = {},
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, requestInit) => {
    const headers = new Headers(requestInit?.headers);
    calls.push({
      headers,
      url: String(input),
    });

    return new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json",
      },
      status: init.status ?? 200,
    });
  };
  return calls;
}
