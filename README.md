# Crispr

A Bun/Turborepo scaffold for long-running coding agents working on a Next.js app.
Shared browser evidence, observability, skills, and verification hooks make each
iteration inspectable and repeatable.

## Workspace

| Path                                           | Purpose                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web`                                     | Next.js App Router app, workspace name `web`                                     |
| `libs/browser-harness`                         | `@crispr/browser-harness`: isolated Playwright/CDP sessions and evidence           |
| `libs/observability`                           | `@crispr/observability`: server telemetry and Loki queries                         |
| `libs/exhaustiveness`                          | `@crispr/exhaustiveness`: exhaustive state checks                                  |
| `libs/ui`                                      | `@crispr/ui`: shared React components                                              |
| `libs/eslint-config`, `libs/typescript-config` | Shared tooling                                                                   |
| `libs/human-model`                             | Reusable React/Three.js component, optimized model assets, and Blender authoring |
| `.agents/skills`                               | Canonical skills shared by agent clients                                         |
| `.codex`, `.claude`, `scripts/agent-hooks`     | Agent profiles, setup, and verification hooks                                    |

Use package imports such as `@crispr/ui/button`; do not import another workspace's
source by relative path. Workspaces are `apps/*` and `libs/*`.

## Start

Requires Bun 1.3.14+, Node 24+, and Git. The Claude worktree hook also uses `jq`.

```sh
bun run setup
bun run --cwd libs/browser-harness install:browsers
bun run dev
```

`bun run dev` builds shared dependencies and starts Next.js, the main UI driver,
on port 3000 by default. After setup, `bun run --cwd apps/web dev` also starts
the app directly. `libs/human-model` supplies a lazy React component and keeps
Blender authoring separate from application UI. See the code maps in
`apps/web/README.md` and `libs/human-model/README.md`.

## Verify

```sh
bun run verify          # hook regression tests, lint, types, tests, production builds
bun run verify:browser  # real Next.js + Chromium/CDP + Next.js MCP diagnostics
```

Browser verification uses port 3101; set `HARNESS_PORT` to select another free
port. It writes `.harness/evidence/<run-id>/` and closes its owned browser and app
processes. Interactive sessions use `browser-harness.yaml`; see
[the agent feedback loop](docs/agent-harness.md) and
[browser harness API](libs/browser-harness/README.md).

Codex and Claude Stop hooks run the same `bun run verify` gate. Failures request
one repair continuation and preserve logs under `.harness/verification`. Repeated
failure produces a warning for an honest handoff, rather than an endless loop.
Browser verification runs explicitly so the hook does not contend with an agent's
existing Next.js dev server. Skipped browser tests do not count as runtime proof.

Setup restores the root lockfile and builds the runtime libraries. It does not
copy `.env.local` files or provision external services. Observability emits local
JSON logs by default; set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable gRPC export and
`LOKI_URL` for log queries. No telemetry backend is assumed to be running.

## Changelog

### 2026-10-17

- Standardized shared workspaces under `libs/` and the `@crispr/*` namespace so copied agent infrastructure resolves against this repository.
- Agent clients share verification and CDP evidence contracts. Hooks orchestrate checks; browser lifecycle and telemetry remain owned by their libraries.
- Next.js owns the application UI; `@crispr/human-model` owns the reusable 3D component and Blender assets. Both package READMEs map the code so agents can find UI, runtime, shader, and asset responsibilities.
