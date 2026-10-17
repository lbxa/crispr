---
name: next-dev-loop
description: Verify Crispr Next.js runtime changes with the repository-owned CDP browser harness and the running Next.js MCP diagnostics endpoint.
---

# Next.js development loop

Use `.agents/skills/browser-harness/SKILL.md` for the browser session and evidence
contract. `apps/web` is the app; `browser-harness.yaml` owns the default command.
Run `bun run verify:browser` for the automated baseline, then exercise the changed
user flow through the same harness API or JSONL session.

For framework diagnosis while `next dev` is running, discover `/_next/mcp` with
`tools/list`. Call the tools advertised by the installed Next.js version rather
than assuming a fixed tool list. In particular inspect compilation issues and
errors when available, after navigating the browser to populate runtime data.
Use the MCP SDK Streamable HTTP transport; the endpoint may respond with SSE.

Check all relevant outcomes:

- The edited route compiles and renders.
- The harness reports no unexplained console errors, page errors, CDP runtime
  exceptions, or failed requests.
- The visible behavior matches the requested change; assert text or interaction.
- The server diagnostics agree with the browser. Preserve both when they disagree.

Do not introduce a second browser driver for this loop. For an existing dev server,
attach with `startApp: false`; use its actual URL and leave its process running.
For an owned server, choose a free port and always stop the harness in `finally`.
Run `bun run verify` before final handoff and report missing runtime evidence.
