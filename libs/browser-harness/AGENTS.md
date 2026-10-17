# Browser harness instructions

- Read `README.md` and `../../docs/agent-harness.md`.
- Import public API from `@crispr/browser-harness`; Bun owns this runtime and its compiled CLI.
- Keep browser lifecycle, CDP, process cleanup, and evidence here; callers own app journeys and orchestration.
- Preserve loopback explicit-target validation, workspace-contained evidence, isolated contexts, and cleanup on failure/EOF/signals.
- Use `@crispr/observability` and propagate the same `harness_run_id` into owned apps.
- Run JSONL `serve` with `bun run --silent --cwd libs/browser-harness cli`, never the filter runner.
- Document reserved configuration honestly. Do not claim redirect confinement, automatic failure assertions, or guaranteed shutdown evidence until enforced and tested.
- Run package lint, check-types, test, and build, then `bun run verify:browser` for runtime changes. Environment blockers are missing runtime evidence, not product regressions.
