# @crispr/observability

Shared Node/Bun telemetry for Crispr apps, agent runs, and local validation.
Pino JSON logs work without external services. OpenTelemetry gRPC logs, spans,
and metrics are enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured.

## Use

```ts
import {
  configureOnceFromEnv,
  getLogger,
  withContext,
  withSpan,
} from "@crispr/observability";

const { guard, created } = configureOnceFromEnv("worker");
const log = getLogger("worker");
try {
  await withContext(
    { task_id: "task-1", harness_run_id: "run-1" },
    async () => {
      await withSpan("agent_iteration", async () => {
        log.info({ outcome: "completed" }, "agent_iteration_completed");
      });
    },
  );
} finally {
  if (created) await guard.shutdown();
}
```

Process owners use `configure` or `configureFromEnv` once and shut down the
returned guard. Libraries use `configureOnceFromEnv` to inherit the parent.
Next.js configures the Node runtime in `apps/web/instrumentation.ts`, with this
package externalized in `next.config.js`; do not import it into client or Edge
code. Build before starting Next directly; Turbo builds dependencies first.

Use `getMetrics` for low-cardinality counters/histograms, `withSpan` for meaningful
I/O, and `withContext` for run/request metadata. Preserve `harness_run_id`,
`task_id`, `session_id`, `browser_session_id`, `commit_sha`, `branch`, `app_name`,
and `test_name`. Optional work-item fields are `issue_id` and `issue_identifier`.
Use stable snake_case event messages with structured identifiers and outcomes.

## Configuration

| Variable                       | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `ENVIRONMENT`                  | Deployment environment, default `development`  |
| `OBSERVABILITY_LOG_LEVEL`      | Minimum log level                              |
| `OBSERVABILITY_CONSOLE_FORMAT` | `json`, `plain`, or `none`                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | Optional OTLP gRPC collector endpoint          |
| `LOKI_URL`                     | Query backend, default `http://127.0.0.1:3100` |
| `LOKI_TENANT`                  | Optional Loki tenant header                    |

No backend is provisioned or assumed. `none` suppresses the console sink while
preserving configured OTLP export, keeping harness JSONL stdout clean.

```ts
import { createLokiRunQuery, lokiSearchLogs } from "@crispr/observability";
const result = await lokiSearchLogs({
  query: createLokiRunQuery("run-1"),
  since: "15m",
  limit: 200,
});
if (!result.success) throw new Error(result.error);
```

Use this boundary for Loki queries rather than implementing HTTP clients in
apps or browsing Grafana for agent diagnosis. Keep queries recent and narrow.
Never log credentials, cookies, authorization headers, private user payloads,
or raw vendor responses. Redaction supplements safe field selection.

## Verification

`bun run --filter '@crispr/observability' test`, `check-types`, `lint`, and `build`.
Tests cover structured fields, context propagation, redaction, lifecycle ownership,
and Loki responses without requiring an external collector.

## Changelog

### 2026-10-17

- Standardized as `@crispr/observability`, with Node ESM output consumed by Next.js instrumentation and Bun source exports for local agent tooling.
- Replaced inherited project-specific backend assumptions with opt-in OTLP export and a configurable standard Loki endpoint; evidence remains usable offline.
