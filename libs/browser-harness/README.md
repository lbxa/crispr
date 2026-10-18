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

`bun run --cwd libs/browser-harness verify:upload --app-url http://localhost:3000`
checks the complete synthetic file → configured IBM upload → summary journey.
It submits the tiny, explicitly synthetic fixture in `fixtures/`, saves correlated
browser evidence, confirms pane switching preserves the result, then reloads to
verify the app starts fresh (no genome, upload prompt showing, no upload-service
requests) and uploads again. It also removes the genome and reloads to verify the
page is empty. The forced-ID
tus client intentionally probes its resource before creating it; this journey
allows one matching HEAD 404 and its matching console message, preserving both
in raw evidence. Other failed requests and errors still fail verification.

`bun run --cwd libs/browser-harness verify:regions --app-url http://localhost:3000`
uses a small synthetic VCF containing known CFTR and HBB alleles. It checks real
backend reference contexts, cross-chromosome finding jumps, karyotype chromosome
ends, DNA-to-karyotype-cursor synchronization and highlighted helix/ladder screenshots. The
fixture contains no patient data; it reuses the upload journey and error policy.

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

| Method                                                | Parameters                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `browser.open`                                        | `{url?: string}` relative to the configured app URL            |
| `browser.snapshot`                                    | none                                                           |
| `browser.click`                                       | `{selector, timeoutMs?}`                                       |
| `browser.type`                                        | `{selector, text, timeoutMs?}`                                 |
| `browser.setInputFiles`                               | `{selector, path, timeoutMs?}`; one workspace-contained file   |
| `browser.press`                                       | `{key}`                                                        |
| `browser.pointer`                                     | `{action: "move", x, y, steps?}` or `{action: "down" \| "up"}` |
| `browser.wait`                                        | `{timeoutMs}`                                                  |
| `browser.waitForText`                                 | `{text, timeoutMs?}`                                           |
| `browser.waitForUrl`                                  | `{url, timeoutMs?}`                                            |
| `browser.screenshot`                                  | `{name?, fullPage?}`                                           |
| `browser.console`, `browser.network`, `browser.close` | none                                                           |

`close`, EOF, and signals shut down owned processes. To attach to a caller-owned
server, pass `--start-app false --app-url http://127.0.0.1:<port>`; it is left alive.

`setInputFiles` targets a native file input, including hidden inputs used by drop
zones. Paths resolve against the configured workspace. Files and symlinks that
resolve outside it, or directory uploads, are rejected. Use synthetic/public
fixtures and keep private genomes out of browser evidence.

`pointer` uses viewport coordinates and a left mouse button. Send move, down,
move, screenshot, then up to inspect a drag while held; the same isolated
Playwright session owns capture, CDP errors, and cleanup.

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

- The app now starts fresh (see `apps/web/README.md`): the left pane opens first with an upload prompt, and a saved genome is discarded on load. The upload journeys upload twice, so up to two initial tus 404 probes are allowed. The minimap's native range is keyboard-only, so the journey focuses it directly.
- Upload journeys wait for `data-genome-cached="true"` before refreshing and `data-genome-cache-ready="true"` afterward, because rendered results alone do not prove an IndexedDB commit. A reload must start without the previous genome and without new upload-service requests; `verify:regions` also exercises the restored DNA findings.
- App-specific Playwright assertions in `verify-genome-upload.ts` use the browser captured through `BrowserSession`'s launch seam. Keep navigation, CDP evidence and cleanup under the same `BrowserHarnessRuntime` so persistence checks do not introduce a separate browser lifecycle.
- The desktop baseline keeps both panes visible at the app's 90rem breakpoint and closes them independently. Compact switching, resize preservation and pane-specific Escape behavior are covered by `apps/web/app/model-workspace.test.tsx`.
- The baseline checks the default avatar and absence of manual profile/region controls. Report-driven avatar selection is covered by app tests; library tests retain both model profiles and highlight lifecycle coverage while developer region controls are disabled.
- The upload journey's `--findings` mode verifies the region map against the configured backend, using synthetic reference alleles rather than downloading stored genomes. It checks both map-to-DNA and DNA-to-map navigation and keeps all browser diagnostics correlated.
- Added an explicit synthetic genome journey against the configured backend. Initial tus HEAD 404 is classified only by this caller; global browser evidence/error recording remains strict.
- Added pointer move/down/up operations to both APIs for evidence captured during a held drag, using the existing session's native Playwright mouse.
- The DNA browser flow also unwinds into the ladder, checks coordinate retention and navigation in that mode, then reopens the pane and rewinds. Scene tests prove planar rails, complementary colors, interrupted transition reversal, and reduced-motion settling.

- The DNA keyboard-scroll check waits for the displayed position to advance within a bounded deadline; a fixed short delay can finish before native scrolling when both WebGL scenes are rendering.

- The Next.js baseline waits for the lazy DNA scene, scrolls, jumps far along a chromosome, checks both chromosome boundaries, and reopens the pane to verify position retention. GPU resource bounds, load cancellation, source validation, and chromosome changes have focused library/app tests.

- Added `setInputFiles` to the TypeScript and JSONL APIs so upload journeys can run through the same CDP/evidence lifecycle. It delegates to Playwright's locator API and requires a real file inside the workspace, checking symlink targets too.
- The Next.js baseline exercises widget keyboard pickup, placement, cancellation before pane dismissal, and cancellation on pane switches. File extraction remains covered by the app's component tests; the real browser check preserves the mounted anatomy scene throughout.
- The Next.js baseline can attach with `--app-url` to avoid competing for the checkout's dev lock; it still captures browser and MCP diagnostics and never stops the caller's server.
- Next.js MCP errors include other connected browser sessions. A clean harness snapshot can coexist with a retained error in an existing tab; inspect that tab and preserve its selections if refreshing before attributing the error to the current run.
- Adopted `@crispr/*` and `apps/web` defaults, retaining the reusable Bun runtime and CDP session ownership.
- Added a real Next.js/Chromium/MCP verification command so browser proof and framework diagnostics share one evidence directory.
