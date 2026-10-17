# @crispr/browser-harness

Local browser runtime for the Crispr Next.js agent loop. Starts or attaches to
an app, launches isolated Chromium with Playwright and CDP, exposes TypeScript
and JSONL operations, and saves browser evidence. The caller owns orchestration.

## Run against Next.js

From the repository root:

```sh
bun run --cwd libs/browser-harness install:browsers
bun run --cwd libs/browser-harness smoke
bun run verify:browser
```

`browser-harness.yaml` starts `apps/web` on 3101. `HARNESS_PORT=3102 bun run
verify:browser` chooses another port. The baseline asserts visible content,
checks browser errors, queries Next.js MCP compilation/runtime diagnostics, and
writes `.harness/evidence/<run-id>/`. This is distinct from `smoke`, which tests
only environment capabilities. Use `docs/agent-harness.md` for the complete loop.

To verify a running dev server without starting another Next.js instance in the
same checkout, run `bun run verify:browser --app-url http://localhost:3000`.
The attached server stays running after verification.

## TypeScript

```ts
import { createBrowserHarness } from "@crispr/browser-harness";

const harness = await createBrowserHarness({
  workspace: process.cwd(),
  configFile: "browser-harness.yaml",
  harnessRunId: "my-unique-run",
  evidenceDir: ".harness/evidence/my-unique-run",
});
try {
  await harness.start();
  await harness.waitForText({ text: "3D anatomy ready", timeoutMs: 90_000 });
  const snapshot = await harness.snapshot();
  await harness.screenshot({ name: "home", fullPage: true });
  console.log(snapshot);
} finally {
  await harness.stop();
}
```

Build first when importing the package root: `bun run --filter
'@crispr/browser-harness' build`. Its compiled CLI and root export target Bun.
Observability also provides a Node ESM build for the Next.js server.

## JSONL

Run from the repository root with stdin kept open:

```sh
bun run --silent --cwd libs/browser-harness cli -- serve --workspace "$PWD" --config browser-harness.yaml --port 3102 --harness-run-id my-unique-run --evidence-dir .harness/evidence/my-unique-run
```

Do not use `--filter` for `serve`; the workspace runner does not preserve stdin.
Each line is `{ "id": "1", "method": "browser.snapshot", "params": {} }`.
Responses echo `id` and contain `result` or `error` with a typed error code.

| Method                                                | Parameters                                          |
| ----------------------------------------------------- | --------------------------------------------------- |
| `browser.open`                                        | `{url?: string}` relative to the configured app URL |
| `browser.snapshot`                                    | none                                                |
| `browser.click`                                       | `{selector, timeoutMs?}`                            |
| `browser.type`                                        | `{selector, text, timeoutMs?}`                      |
| `browser.press`                                       | `{key}`                                             |
| `browser.wait`                                        | `{timeoutMs}`                                       |
| `browser.waitForText`                                 | `{text, timeoutMs?}`                                |
| `browser.waitForUrl`                                  | `{url, timeoutMs?}`                                 |
| `browser.screenshot`                                  | `{name?, fullPage?}`                                |
| `browser.console`, `browser.network`, `browser.close` | none                                                |

`close`, EOF, and signals shut down owned processes. To attach to a caller-owned
server, pass `--start-app false --app-url http://127.0.0.1:<port>`; it is left alive.

## Evidence and telemetry

Snapshots include accessible/visible text, console errors, page errors, CDP
runtime exceptions, failed requests, title, and URL. Evidence includes
`final-snapshot.json`, `console.json`, `network.json`, and screenshots. The Next.js
verification also saves `run-context.json` with correlation IDs. Events use
`@crispr/observability` and `harness_run_id`; owned apps inherit the run context.
Loki querying is optional through `ObservabilityClient` or the observability API.
Its default URL is `http://127.0.0.1:3100`, overridable with `LOKI_URL`.

Explicit navigation targets are loopback-only unless allowed; evidence paths
must be inside the workspace. Redirect/click destinations are not fully confined.
Console and page-error messages are captured verbatim, so apps must keep secrets
out of browser diagnostics. Evaluation, raw CDP access, video, persisted state,
screenshot suppression, and automatic console/network failure flags are reserved
configuration; the verification caller explicitly asserts errors. Shutdown
evidence is best-effort: take an awaited snapshot before relying on saved files.

## Changelog

### 2026-10-17

- The Next.js baseline can attach with `--app-url` to avoid competing for the checkout's dev lock; it still captures browser and MCP diagnostics and never stops the caller's server.
- Next.js MCP errors include other connected browser sessions. A clean harness snapshot can coexist with a retained error in an existing tab; inspect that tab and preserve its selections if refreshing before attributing the error to the current run.
- Adopted `@crispr/*` and `apps/web` defaults, retaining the reusable Bun runtime and CDP session ownership.
- Added a real Next.js/Chromium/MCP verification command so browser proof and framework diagnostics share one evidence directory.
