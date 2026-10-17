import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger } from "pino";
import {
  context as otelContext,
  isSpanContextValid,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
} from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
  type Logger as OtelLogger,
} from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type ConsoleFormat = "json" | "plain" | "none";
export type TelemetryValue =
  string | number | boolean | string[] | number[] | boolean[];
export type TelemetryFields = Record<
  string,
  TelemetryValue | Error | null | undefined
>;

export type LogDestination = {
  write(line: string): void;
};

export type LokiSearchInput = {
  service?: string;
  level?: string;
  contains?: string;
  query?: string;
  since?: string;
  limit?: number;
};

export type LokiSearchOptions = {
  lokiBaseUrl?: string;
};

export type LokiRunQueryOptions = {
  eventName?: string | RegExp;
  level?: string;
  surface?: string;
};

export type LokiLogEntry = {
  ts: string;
  labels: Record<string, string>;
  line: string;
};

export type LokiSearchResult =
  | {
      success: true;
      query: string;
      since: string;
      limit: number;
      entries: LokiLogEntry[];
      truncated: boolean;
    }
  | {
      success: false;
      error: string;
      body: string;
    };

export type ObservabilityConfig = {
  serviceName: string;
  environment?: string;
  level?: LogLevel;
  consoleFormat?: ConsoleFormat;
  otlpEndpoint?: string | null;
  exportLogs?: boolean;
  exportTraces?: boolean;
  exportMetrics?: boolean;
  metricExportIntervalMillis?: number;
  destination?: LogDestination;
};

type ResolvedConfig = Required<
  Omit<ObservabilityConfig, "otlpEndpoint" | "destination">
> & {
  otlpEndpoint: string | null;
  destination?: LogDestination;
};

type Providers = {
  loggerProvider?: LoggerProvider;
  tracerProvider?: NodeTracerProvider;
  meterProvider?: MeterProvider;
  otelLogger?: OtelLogger;
};

const DEFAULT_ENVIRONMENT = "development";
const DEFAULT_LEVEL: LogLevel = "info";
const DEFAULT_CONSOLE_FORMAT: ConsoleFormat = "json";
const DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS = 10_000;
const DEFAULT_LOKI_URL = "http://127.0.0.1:3100";
const DEFAULT_LOKI_SINCE = "15m";
const DEFAULT_LOKI_LIMIT = 200;
const MAX_LOKI_LIMIT = 1_000;
const MAX_LOKI_LINE_LENGTH = 2_048;
const LOKI_TIMEOUT_MILLIS = 5_000;
const NOOP_DESTINATION: LogDestination = {
  write() {
    // Intentionally discard console output while preserving OpenTelemetry export.
  },
};

const FIELD_ALIASES: Record<string, string> = {
  actor_type: "actor.type",
  audit_event_type: "audit.event_type",
  correlation_id: "correlation.id",
  request_id: "request.id",
  workflow: "workflow.name",
  operation_id: "operation.id",
};

const REDACT_PATHS = [
  "access_token",
  "address",
  "authorization",
  "card_number",
  "cookie",
  "cvv",
  "full_address",
  "health_answers",
  "password",
  "payment",
  "raw_bloodwork",
  "refresh_token",
  "secret",
  "token",
  "*.access_token",
  "*.address",
  "*.authorization",
  "*.card_number",
  "*.cookie",
  "*.cvv",
  "*.full_address",
  "*.health_answers",
  "*.password",
  "*.payment",
  "*.raw_bloodwork",
  "*.refresh_token",
  "*.secret",
  "*.token",
];

const contextStorage = new AsyncLocalStorage<Record<string, unknown>>();

let activeConfig: ResolvedConfig | null = null;
let activeProviders: Providers = {};
let activeGuard: ObservabilityGuard | null = null;
let activeLevel: LogLevel = DEFAULT_LEVEL;
let loggerCache = new Map<string, Logger>();

export class ObservabilityGuard {
  readonly config: ResolvedConfig;
  #providers: Providers;
  #shutdown = false;

  constructor(config: ResolvedConfig, providers: Providers) {
    this.config = config;
    this.#providers = providers;
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) {
      return;
    }
    this.#shutdown = true;

    await Promise.allSettled([
      this.#providers.loggerProvider?.shutdown(),
      this.#providers.meterProvider?.shutdown(),
      this.#providers.tracerProvider?.shutdown(),
    ]);
  }
}

export function configure(config: ObservabilityConfig): ObservabilityGuard {
  if (activeConfig) {
    throw new Error("Observability is already configured for this process.");
  }

  const resolved = resolveConfig(config);
  const providers = setupProviders(resolved);
  activeConfig = resolved;
  activeProviders = providers;
  activeLevel = resolved.level;
  activeGuard = new ObservabilityGuard(resolved, providers);
  return activeGuard;
}

export function isConfigured(): boolean {
  return activeConfig !== null && activeGuard !== null;
}

export function configureOnceFromEnv(
  serviceName: string,
  overrides: Partial<ObservabilityConfig> = {},
): { guard: ObservabilityGuard; created: boolean } {
  if (activeGuard) {
    return { guard: activeGuard, created: false };
  }
  return { guard: configureFromEnv(serviceName, overrides), created: true };
}

export function configureFromEnv(
  serviceName: string,
  overrides: Partial<ObservabilityConfig> = {},
): ObservabilityGuard {
  return configure({
    serviceName,
    environment: envString("ENVIRONMENT") ?? DEFAULT_ENVIRONMENT,
    level: parseLogLevel(envString("OBSERVABILITY_LOG_LEVEL") ?? DEFAULT_LEVEL),
    consoleFormat: parseConsoleFormat(
      envString("OBSERVABILITY_CONSOLE_FORMAT") ?? DEFAULT_CONSOLE_FORMAT,
    ),
    otlpEndpoint: envString("OTEL_EXPORTER_OTLP_ENDPOINT"),
    metricExportIntervalMillis: parsePositiveInteger(
      "OTEL_METRIC_EXPORT_INTERVAL_MILLIS",
      envString("OTEL_METRIC_EXPORT_INTERVAL_MILLIS"),
      DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS,
    ),
    ...overrides,
  });
}

export function getLogger(name: string): Logger {
  const config = requireActiveConfig();
  const cached = loggerCache.get(name);
  if (cached) {
    return cached;
  }

  const logger = pino(
    {
      base: null,
      errorKey: "err",
      level: activeLevel,
      messageKey: "message",
      redact: {
        paths: REDACT_PATHS,
        censor: "[Redacted]",
      },
      timestamp: false,
      mixin() {
        return {
          ...currentEnvironmentFields(),
          ...currentContextFields(),
          ...currentTraceFields(),
        };
      },
      mixinMergeStrategy(logFields, mixinFields) {
        return {
          ...mixinFields,
          ...logFields,
        };
      },
      formatters: {
        level(label) {
          return { level: label };
        },
        bindings() {
          return {
            logger: name,
            service_name: config.serviceName,
            environment: config.environment,
          };
        },
      },
      hooks: {
        streamWrite(line) {
          const payload = normalizePinoLine(line, config, name);
          emitOtelLog(payload);
          return formatConsolePayload(payload, config.consoleFormat);
        },
      },
    },
    config.consoleFormat === "none" ? NOOP_DESTINATION : config.destination,
  );

  loggerCache.set(name, logger);
  return logger;
}

export function withContext<T>(
  fields: TelemetryFields,
  run: () => T | Promise<T>,
): T | Promise<T> {
  const existing = contextStorage.getStore() ?? {};
  return contextStorage.run({ ...existing, ...mapFields(fields) }, run);
}

export async function withSpan<T>(
  name: string,
  attributes: TelemetryFields,
  run: () => T | Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("observability-ts");
  return tracer.startActiveSpan(name, async (span) =>
    runWithSpan(span, attributes, run),
  );
}

export class MetricsRecorder {
  #meter: Meter;
  #counters = new Map<string, Counter>();
  #histograms = new Map<string, Histogram>();

  constructor(
    private readonly namespace = "observability-ts",
    private readonly version = "0.1.0",
  ) {
    this.#meter = metrics.getMeter(this.namespace, this.version);
  }

  increment(
    name: string,
    value = 1,
    attributes: TelemetryFields = {},
    options: { unit?: string; description?: string } = {},
  ): void {
    let counter = this.#counters.get(name);
    if (!counter) {
      counter = this.#meter.createCounter(name, {
        unit: options.unit ?? "1",
        description: options.description,
      });
      this.#counters.set(name, counter);
    }
    counter.add(
      value,
      cleanAttributes({ ...currentEnvironmentFields(), ...attributes }),
    );
  }

  record(
    name: string,
    value: number,
    attributes: TelemetryFields = {},
    options: { unit?: string; description?: string } = {},
  ): void {
    let histogram = this.#histograms.get(name);
    if (!histogram) {
      histogram = this.#meter.createHistogram(name, {
        unit: options.unit ?? "1",
        description: options.description,
      });
      this.#histograms.set(name, histogram);
    }
    histogram.record(
      value,
      cleanAttributes({ ...currentEnvironmentFields(), ...attributes }),
    );
  }
}

export function getMetrics(
  namespace = "observability-ts",
  version = "0.1.0",
): MetricsRecorder {
  return new MetricsRecorder(namespace, version);
}

export function setLevel(level: LogLevel): void {
  const parsed = parseLogLevel(level);
  activeLevel = parsed;
  for (const logger of loggerCache.values()) {
    logger.level = parsed;
  }
}

export function getLevel(): LogLevel {
  return activeLevel;
}

export async function lokiSearchLogs(
  input: LokiSearchInput,
  options: LokiSearchOptions = {},
): Promise<LokiSearchResult> {
  const baseUrl =
    nonEmptyString(options.lokiBaseUrl) ??
    envString("LOKI_URL") ??
    DEFAULT_LOKI_URL;
  const limit = resolveLokiLimit(input.limit);
  const since = nonEmptyString(input.since) ?? DEFAULT_LOKI_SINCE;
  const query = nonEmptyString(input.query) ?? createLokiSearchQuery(input);

  const url = new URL("/loki/api/v1/query_range", baseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("since", since);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("direction", "backward");

  const headers: Record<string, string> = {};
  const tenant = envString("LOKI_TENANT");
  if (tenant) {
    headers["X-Scope-OrgID"] = tenant;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(LOKI_TIMEOUT_MILLIS),
    });
  } catch (error) {
    return {
      body: error instanceof Error ? error.message : String(error),
      error: "loki_fetch_failed",
      success: false,
    };
  }

  if (!response.ok) {
    return {
      body: await response.text(),
      error: `loki_http_${response.status}`,
      success: false,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      body: error instanceof Error ? error.message : String(error),
      error: "loki_invalid_response",
      success: false,
    };
  }

  const entries = parseLokiEntries(body);
  if (!entries) {
    return {
      body: "Unexpected Loki query_range response shape",
      error: "loki_invalid_response",
      success: false,
    };
  }

  return {
    entries,
    limit,
    query,
    since,
    success: true,
    truncated: entries.length >= limit,
  };
}

export function createLokiRunQuery(
  runId: string,
  options: LokiRunQueryOptions = {},
): string {
  const filters = [`harness_run_id=${quoteLogQLString(runId)}`];
  if (options.level) {
    filters.push(`level=${quoteLogQLString(options.level)}`);
  }
  if (options.surface) {
    filters.push(`surface=${quoteLogQLString(options.surface)}`);
  }
  if (typeof options.eventName === "string") {
    filters.push(`event_name=${quoteLogQLString(options.eventName)}`);
  } else if (options.eventName) {
    filters.push(
      `event_name=~${quoteLogQLString(regExpSource(options.eventName))}`,
    );
  }

  return [
    `{service_name=~".+"}`,
    ...filters.map((filter) => `| ${filter}`),
  ].join(" ");
}

/** @internal */
export async function __resetForTests(): Promise<void> {
  await activeGuard?.shutdown();
  activeConfig = null;
  activeProviders = {};
  activeGuard = null;
  activeLevel = DEFAULT_LEVEL;
  loggerCache = new Map();
  logs.disable();
}

async function runWithSpan<T>(
  span: Span,
  attributes: TelemetryFields,
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    span.setAttributes(
      cleanAttributes({ ...currentEnvironmentFields(), ...attributes }),
    );
    const result = await run();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

function resolveConfig(config: ObservabilityConfig): ResolvedConfig {
  const metricExportIntervalMillis =
    config.metricExportIntervalMillis ?? DEFAULT_METRIC_EXPORT_INTERVAL_MILLIS;
  if (
    !Number.isSafeInteger(metricExportIntervalMillis) ||
    metricExportIntervalMillis <= 0
  ) {
    throw new Error("metricExportIntervalMillis must be a positive integer.");
  }

  return {
    serviceName: requiredString("serviceName", config.serviceName),
    environment: nonEmptyString(config.environment) ?? DEFAULT_ENVIRONMENT,
    level: parseLogLevel(config.level ?? DEFAULT_LEVEL),
    consoleFormat: parseConsoleFormat(
      config.consoleFormat ?? DEFAULT_CONSOLE_FORMAT,
    ),
    otlpEndpoint: nonEmptyString(config.otlpEndpoint ?? null),
    exportLogs: config.exportLogs ?? true,
    exportTraces: config.exportTraces ?? true,
    exportMetrics: config.exportMetrics ?? true,
    metricExportIntervalMillis,
    destination: config.destination,
  };
}

function setupProviders(config: ResolvedConfig): Providers {
  if (!config.otlpEndpoint) {
    return {};
  }

  const resource = new Resource({
    "service.name": config.serviceName,
    "deployment.environment.name": config.environment,
  });
  const providers: Providers = {};
  const exporterConfig = { url: config.otlpEndpoint };

  if (config.exportTraces) {
    const tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter(exporterConfig)),
      ],
    });
    tracerProvider.register();
    providers.tracerProvider = tracerProvider;
  }

  if (config.exportMetrics) {
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(exporterConfig),
      exportIntervalMillis: config.metricExportIntervalMillis,
    });
    const meterProvider = new MeterProvider({
      resource,
      readers: [metricReader],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    providers.meterProvider = meterProvider;
  }

  if (config.exportLogs) {
    const loggerProvider = new LoggerProvider({ resource });
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(new OTLPLogExporter(exporterConfig)),
    );
    logs.setGlobalLoggerProvider(loggerProvider);
    providers.loggerProvider = loggerProvider;
    providers.otelLogger = loggerProvider.getLogger(
      "observability-ts",
      "0.1.0",
    );
  }

  return providers;
}

function normalizePinoLine(
  line: string,
  config: ResolvedConfig,
  loggerName: string,
): Record<string, unknown> {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    logger: loggerName,
    service_name: config.serviceName,
    environment: config.environment,
    trace_id: null,
    span_id: null,
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (key === "err") {
      copyErrorFields(payload, value);
      continue;
    }
    payload[FIELD_ALIASES[key] ?? key] = value;
  }

  const message =
    typeof payload["message"] === "string" ? payload["message"] : loggerName;
  payload["message"] = message;
  payload["event.name"] =
    typeof payload["event.name"] === "string" ? payload["event.name"] : message;
  payload["trace_id"] = payload["trace_id"] ?? null;
  payload["span_id"] = payload["span_id"] ?? null;
  return payload;
}

function copyErrorFields(
  payload: Record<string, unknown>,
  value: unknown,
): void {
  if (value instanceof Error) {
    payload["error.type"] = value.name;
    payload["error.message"] = value.message;
    payload["error.stack"] = value.stack ?? "";
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const type = value.type ?? value.name;
  const message = value.message;
  const stack = value.stack;
  if (typeof type === "string") {
    payload["error.type"] = type;
  }
  if (typeof message === "string") {
    payload["error.message"] = message;
  }
  if (typeof stack === "string") {
    payload["error.stack"] = stack;
  }
}

function formatConsolePayload(
  payload: Record<string, unknown>,
  format: ConsoleFormat,
): string {
  if (format === "json") {
    return `${JSON.stringify(payload)}\n`;
  }
  if (format === "none") {
    return "";
  }

  const parts = [
    display(payload["timestamp"]),
    display(payload["level"]),
    display(payload["service_name"]),
    display(payload["environment"]),
    display(payload["logger"]),
    display(payload["message"]),
  ];
  const extras = Object.entries(payload)
    .filter(
      ([key, value]) =>
        !basePlainKeys.has(key) && value !== null && value !== undefined,
    )
    .map(([key, value]) => `${key}=${display(value)}`);
  return `${[...parts, ...extras].join(" ")}\n`;
}

const basePlainKeys = new Set([
  "timestamp",
  "level",
  "service_name",
  "environment",
  "logger",
  "message",
]);

function emitOtelLog(payload: Record<string, unknown>): void {
  const otelLogger = activeProviders.otelLogger;
  if (!otelLogger) {
    return;
  }

  otelLogger.emit({
    observedTimestamp: Date.now(),
    severityNumber: severityNumber(payload["level"]),
    severityText:
      typeof payload["level"] === "string"
        ? payload["level"].toUpperCase()
        : undefined,
    body: payload["message"] as string,
    attributes: cleanAttributes(payload),
    context: otelContext.active(),
  });
}

function severityNumber(level: unknown): SeverityNumber {
  switch (level) {
    case "trace":
      return SeverityNumber.TRACE;
    case "debug":
      return SeverityNumber.DEBUG;
    case "info":
      return SeverityNumber.INFO;
    case "warn":
      return SeverityNumber.WARN;
    case "error":
      return SeverityNumber.ERROR;
    case "fatal":
      return SeverityNumber.FATAL;
    default:
      return SeverityNumber.UNSPECIFIED;
  }
}

function currentContextFields(): Record<string, unknown> {
  return contextStorage.getStore() ?? {};
}

function currentEnvironmentFields(): Record<string, unknown> {
  return mapFields({
    app_name: envString("APP_NAME"),
    branch: envString("BRANCH"),
    browser_session_id: envString("BROWSER_SESSION_ID"),
    commit_sha: envString("COMMIT_SHA"),
    harness_run_id: envString("HARNESS_RUN_ID"),
    issue_id: envString("ISSUE_ID") ?? envString("LINEAR_ISSUE_ID"),
    issue_identifier:
      envString("ISSUE_IDENTIFIER") ?? envString("LINEAR_ISSUE_IDENTIFIER"),
    session_id: sessionIdFromEnv(),
    task_id: envString("TASK_ID"),
    test_name: envString("TEST_NAME"),
  });
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

function currentTraceFields(): Record<string, unknown> {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return {
      trace_id: null,
      span_id: null,
    };
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

function mapFields(fields: TelemetryFields): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      continue;
    }
    mapped[FIELD_ALIASES[key] ?? key] = value;
  }
  return mapped;
}

function cleanAttributes(fields: Record<string, unknown>): Attributes {
  const cleaned: Attributes = {};
  for (const [key, value] of Object.entries(
    mapFields(fields as TelemetryFields),
  )) {
    if (isAttributeValue(value)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function isAttributeValue(value: unknown): value is Attributes[string] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) =>
    ["string", "number", "boolean"].includes(typeof item),
  );
}

function requireActiveConfig(): ResolvedConfig {
  if (!activeConfig) {
    return configure({ serviceName: "observability-ts" }).config;
  }
  return activeConfig;
}

function parseLogLevel(level: string): LogLevel {
  const normalized = level.trim().toLowerCase();
  if (
    normalized === "trace" ||
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "fatal"
  ) {
    return normalized;
  }
  if (normalized === "warning") {
    return "warn";
  }
  throw new Error(`Unknown log level: ${level}`);
}

function parseConsoleFormat(format: string): ConsoleFormat {
  const normalized = format.trim().toLowerCase();
  if (
    normalized === "json" ||
    normalized === "plain" ||
    normalized === "none"
  ) {
    return normalized;
  }
  throw new Error(`Unknown console format: ${format}`);
}

function envString(name: string): string | null {
  return nonEmptyString(process.env[name]);
}

function parsePositiveInteger(
  name: string,
  value: string | null,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function requiredString(name: string, value: string): string {
  const resolved = nonEmptyString(value);
  if (!resolved) {
    throw new Error(`${name} is required.`);
  }
  return resolved;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function display(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function createLokiSearchQuery(input: LokiSearchInput): string {
  const service = nonEmptyString(input.service) ?? "app";
  const filters = [`{service_name=${JSON.stringify(service)}}`];
  const contains = nonEmptyString(input.contains);
  if (contains) {
    filters.push(`|= ${JSON.stringify(contains)}`);
  }
  const level = nonEmptyString(input.level);
  if (level) {
    filters.push(`| json | level=${JSON.stringify(level)}`);
  }
  return filters.join(" ");
}

function resolveLokiLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LOKI_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LOKI_LIMIT);
}

function parseLokiEntries(body: unknown): LokiLogEntry[] | null {
  if (!isRecord(body) || body.status !== "success" || !isRecord(body.data)) {
    return null;
  }
  const result = body.data.result;
  if (!Array.isArray(result)) {
    return null;
  }

  const entries: LokiLogEntry[] = [];
  for (const stream of result) {
    if (
      !isRecord(stream) ||
      !isStringRecord(stream.stream) ||
      !Array.isArray(stream.values)
    ) {
      return null;
    }
    for (const value of stream.values) {
      if (!isLokiStreamValue(value)) {
        return null;
      }
      const [timestampUnixNano, line] = value;
      const ts = lokiTimestampToIso(timestampUnixNano);
      if (!ts) {
        return null;
      }
      entries.push({
        labels: stream.stream,
        line: line.slice(0, MAX_LOKI_LINE_LENGTH),
        ts,
      });
    }
  }
  return entries;
}

function lokiTimestampToIso(timestampUnixNano: string): string | null {
  try {
    const milliseconds = Number(BigInt(timestampUnixNano) / 1_000_000n);
    if (!Number.isFinite(milliseconds)) {
      return null;
    }
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function quoteLogQLString(value: string): string {
  return JSON.stringify(value);
}

function regExpSource(value: RegExp): string {
  return value.source;
}

function isLokiStreamValue(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
