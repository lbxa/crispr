# Observability instructions

- Import public APIs from `@crispr/observability`; apps must not configure separate Pino/OTel stacks.
- Read `README.md`. Node/Bun only; Next.js startup is `apps/web/instrumentation.ts`.
- Process owners configure once and shut down their guard. Libraries inherit configuration with `configureOnceFromEnv`.
- Carry run, task, request, and session context with `withContext`; instrument meaningful I/O with `withSpan`.
- Use stable event names and structured outcomes. Never include credentials or private raw payloads.
- Use `lokiSearchLogs` for agent log queries. `LOKI_URL` overrides the default `http://127.0.0.1:3100`; no backend is provisioned by this scaffold.
- Keep deterministic tests independent of external collectors. Run test, lint, check-types, and build after changes.
