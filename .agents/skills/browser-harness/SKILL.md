---
name: browser-harness
description: Verify and debug the Crispr Next.js app using the repository-owned Playwright/CDP harness, isolated sessions, and correlated browser evidence.
---

# Browser harness

Read `docs/agent-harness.md` and `libs/browser-harness/README.md`.
Use this harness for this repository's browser verification so console, network,
CDP exceptions, screenshots, and run identity reach the same evidence bundle.

1. Run `bun run --cwd libs/browser-harness smoke` once to check Chromium and loopback access.
2. Run `bun run verify:browser` for the baseline Next.js runtime check. It starts
   `apps/web`, checks the page and diagnostics, and cleans up its process tree.
   Use `HARNESS_PORT=<free-port>` when another checkout already owns the default.
3. For an interactive flow, run from the repository root:

   ```sh
   bun run --silent --cwd libs/browser-harness cli -- serve --workspace "$PWD" --config browser-harness.yaml --port 3102 --harness-run-id <unique-id> --evidence-dir .harness/evidence/<unique-id>
   ```

   Keep stdin open. Send one JSON request per line with a string `id`:

   ```json
   {"id":"1","method":"browser.open","params":{"url":"/"}}
   {"id":"2","method":"browser.snapshot"}
   {"id":"3","method":"browser.screenshot","params":{"name":"reproduction"}}
   {"id":"4","method":"browser.close"}
   ```

   Choose selectors from snapshots. Methods include `browser.click`, `type`,
   `press`, `waitForText`, `waitForUrl`, `console`, and `network`; their parameter
   names are documented in the library README. Do not route JSONL through the
   workspace filter runner, which does not preserve stdin.
4. Assert the actual user outcome. Inspect `consoleErrors`, `pageErrors`,
   `runtimeExceptions`, and `failedRequests`; a screenshot alone is insufficient.
   Save evidence before closing and include its path and run ID in the handoff.
5. Close the session in `finally` or with `browser.close`; EOF and signals also
   trigger cleanup. Do not kill unrelated dev servers.

For an already running app, pass `--start-app false --app-url <loopback-url>`.
The harness does not terminate attached servers. Authentication and product
journeys belong to the caller. Never put credentials in evidence or browser logs.

An `environment_blocked_*` result is an environment failure. Preserve it and
report which browser check remains unverified. Do not count skipped integration
tests or successful compilation as browser verification.
