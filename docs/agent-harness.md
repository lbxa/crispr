# Agent feedback loop

## Ownership and architecture contract

The repository supports long-running agent edits to `apps/web`. The agent owns
task scope, iteration, worktrees, and handoff. Hooks own deterministic gate
invocation. `@crispr/browser-harness` owns local app processes, isolated Chromium
contexts, CDP exceptions, and evidence. `@crispr/observability` owns Pino,
OpenTelemetry providers, correlation, and Loki queries. Next.js owns rendering
and framework diagnostics. Product flows and credentials remain in callers.

Likely change points are app routes, agent clients, and diagnostic tools. Keep
client-specific hook payloads at the script adapters and browser automation in
the harness. Use existing SDKs for Playwright, MCP, telemetry, and validation.
No persistence repository or database transaction is needed for this scaffold.
Evidence is filesystem output scoped to one run; partial failures remain visible.

Invariants: one owned app process tree per session, isolated browser context,
loopback explicit targets by default, evidence inside the workspace, unique run
IDs, correlated telemetry, cleanup on error/EOF/signal, and verification failures
that remain failures. Launch retries clean resources before retrying. Worktree
creation rolls back only resources it created; reuse preserves existing work.
See the browser library's documented limits before relying on confinement.

## Iteration

1. Read root and owning package instructions, then inspect the current execution path.
2. Implement a bounded change and run the owning package's checks.
3. For runtime changes, run `bun run verify:browser` and exercise the changed flow
   through the harness. Save snapshot, console, network, CDP exceptions, screenshot,
   and framework diagnostics under one run ID.
4. Fix the observed failure and repeat the relevant check. Classify environmental
   blockers separately from product failures; preserve the original diagnostics.
5. Run `bun run verify` before handoff. Include material limitations and evidence
   paths. Capture durable decisions in the owning README changelog.

`.agents/skills/verify/SKILL.md`, `browser-harness/SKILL.md`, and
`next-dev-loop/SKILL.md` define these workflows for both Codex and Claude.
Other copied skills remain available for their specific tasks; their generic
examples do not override the repository's workspace or runtime conventions.

## Hooks and worktrees

Codex `.codex/hooks.json` invokes its thin adapter; Claude `.claude/settings.json`
invokes `scripts/agent-hooks/stop-checks.sh` directly. Both run `bun run verify`.
The first failure returns `decision: block`. A continued Stop that still fails
emits `systemMessage` with unresolved-failure guidance. The exit does not certify
success. Each invocation keeps a unique log in `.harness/verification/`.

Claude WorktreeCreate requires a committed base ref. It uses cached `origin/HEAD`
or local `HEAD`; `CRISPR_WORKTREE_BASE_REF` selects another committed ref. Setup
uses the committed root lockfile. New branches and checkouts are rolled back on
setup failure; existing worktrees are retained. Hook tests use real isolated Git
fixtures and do not require a commit in the calling checkout or network access.

## Observability and evidence

Next.js `instrumentation.ts` configures the Node runtime and records startup and
request failures. The harness passes `HARNESS_RUN_ID`, `SESSION_ID`, `TASK_ID`,
branch, commit, test, and app identity to owned child processes. Browser console,
page errors, and network failures share that context. Harness stdio stays valid
JSONL; its default console telemetry sink is disabled.

Local evidence works without an external telemetry stack. OTLP gRPC export is
opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`; query an existing Loki backend through
`@crispr/observability` with `LOKI_URL`. No Docker or cloud service is required by
the deterministic gate. Never log credentials or private payloads.

## Verification boundaries

`bun run verify` covers hook success/failure/continuation, worktree create/reuse/
rollback, library unit and browser integration tests, lint, types, and builds.
Browser integration can skip when Chromium is unavailable; the explicit
`verify:browser` gate fails in that case. It launches a real Next.js server,
asserts the home page and real model readiness, switches profiles and selects a
region, records screenshots and diagnostics, queries the advertised
Next.js MCP tools, and rejects browser or framework errors.

Build and type generation both write `.next/types`; keep them ordered in the
verification task graph. Interactive JSONL must run package-locally, since Bun's
workspace filter runner does not preserve stdin.
