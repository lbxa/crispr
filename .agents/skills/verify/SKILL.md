---
name: verify
description: Run the Crispr deterministic verification and browser feedback loops before handing off repository changes or resuming long-running agent work.
---

# Verify

Use `bun run verify` from the repository root. It tests agent hooks, then runs
workspace lint, type checks, tests, and production builds through Turbo.
Fix a failing owning package with a narrow command, then rerun the full gate.
Tests always execute; deterministic build/type/lint checks may use Turbo cache.

For browser, app runtime, or harness changes, also use the `browser-harness`
skill and run `bun run verify:browser`. This check requires Chromium and a free
loopback port; it is separate from the Stop hook to avoid locking the same
Next.js checkout while an agent has an interactive dev server running.

Both Codex and Claude Stop hooks invoke the same gate. A failed first Stop
requests one repair continuation. A repeated failure emits a warning and permits
an honest handoff. It does not turn failed verification into success. Logs live
under `.harness/verification/`; include unresolved failures in the final response.
