# Crispr agent harness

This is a Bun/Turborepo scaffold for long-running agents. Read `README.md` and
`docs/agent-harness.md` before changing runtime or agent infrastructure.

- `apps/web` is the Next.js app; shared workspaces live in `libs/*` as `@crispr/*`.
- Use Bun and declared workspace package imports. Keep `.agents/skills` canonical
  for both Codex and Claude; client-specific profiles and hooks live in `.codex`
  and `.claude`.
- Run `bun run verify` before handoff. For app or browser runtime changes, also
  follow `.agents/skills/browser-harness/SKILL.md` and run `bun run verify:browser`.
  Use narrow package checks while iterating; report environmental blockers.
- Use `@crispr/observability` for server and harness telemetry; keep run/task/session
  identity correlated and secrets out of logs and evidence.
- Browser sessions own child-process cleanup and CDP evidence. Agent hooks invoke
  shared verification; do not duplicate verification pipelines in client configs.
- Next.js owns UI in `apps/web/app`; `libs/human-model` exports the reusable React
  component and owns the Three.js scene. Read both package READMEs for code maps.
  Preserve canonical Blender assets; browsers consume generated runtime derivatives.
- For library/API documentation use Context7: resolve the library ID, then query
  the specific question. If unavailable, disclose that and use installed or
  official documentation. Follow the installed Turbo documentation rule below.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
