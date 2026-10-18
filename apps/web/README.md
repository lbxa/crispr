# Crispr web

The Next.js App Router application owns the gene editing software's UI and
navigation. The current page establishes the anatomy workspace; genetic edit
operations and workflow policy should be added at the application boundary.

## Code map

| File                                            | Owns                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `app/page.tsx`                                  | Server-rendered page shell and built asset URLs                       |
| `app/model-workspace.tsx`                       | React panes, report-driven avatar profile, disabled developer regions and lazy `HumanModel` |
| `app/file-drop-card.tsx`                        | Single-file VCF selection, size/type checks, and replacement          |
| `app/genome-explorer.tsx`, `app/demo-genome.ts` | Right-pane DNA navigation and a position-addressable synthetic genome |
| `app/genome-minimap.tsx`                        | Chromosome minimap, accessible scrubbing and exact finding jumps      |
| `app/genome-analysis/genome-view.ts`            | Validated BED-compatible map and bounded reference-context source     |
| `app/genome-analysis/client.ts`                 | Capability-bound IBM tus transfers, pause/resume, and job polling     |
| `app/genome-analysis/use-genome-analysis.ts`    | Workspace upload ownership, cancellation, and latest-file state       |
| `app/genome-analysis/cache.ts`                   | Versioned IndexedDB cache of the current genome metadata and report   |
| `app/genome-analysis/summary-card.tsx`          | Processing, failure/retry, and backend summary presentation           |
| `app/genome-analysis/contract.ts`, `backend.ts` | Validated report contract and server-only Python API adapter          |
| `app/api/genome-uploads/config/route.ts`        | Public IBM upload origin and bounded transfer settings                |
| `app/api/analyze/route.ts`                      | Compatibility small-file multipart route and safe request telemetry   |
| `../../libs/widget-grid/README.md`              | Grid layout, reordering, widget sizing, and interaction contracts     |
| `app/page.module.css`, `app/globals.css`        | App layout and styling                                                |
| `app/advisability-test/`                        | Integration test page for the backend's CRISPRon advisability score   |
| `app/layout.tsx`                                | Fonts and page metadata                                               |
| `instrumentation.ts`                            | Node server observability                                             |
| `wrangler.jsonc`, `open-next.config.ts`         | Cloudflare Worker deployment, bindings, and adapter settings          |
| `scripts/sync-model-assets.ts`                  | Copies the library's generated assets into Next's public directory    |
| `../../libs/human-model/src/scene.ts`           | Three.js scene lifecycle, not app policy                              |

Import the component from `@crispr/human-model`; import lightweight metadata from
`@crispr/human-model/profiles` or `/anatomy`. The app does not import Three.js or
query library internals. New scene behavior belongs in the library; page controls,
research workflows, routing, and data fetching belong here.

## Run and verify

From the repository root:

```sh
bun run setup
bun run dev
bun run verify
bun run verify:browser
```

Next.js is the only UI dev server, normally on 3000. `dev` and `build` copy the
prebuilt model assets; root Turbo commands build the library first. If invoking
the app directly, run setup or build `@crispr/human-model` first.

The main page remains a Server Component. Its client controls dynamically import
the WebGL component with SSR disabled. The HTML shell renders independently of
Three.js and model downloads. Only the selected profile is fetched. The library
build produces hashed, optimized GLBs; Next serves them as immutable static
assets. Do not serve the much larger Blender exports to browsers or add them to
the initial client bundle. Generated `public/models/human` is ignored by Git and
included in Turbo's build outputs so cached production builds retain assets.

Browser verification covers model readiness, absence of manual profile/developer controls,
pane switching and keyboard dismissal, screenshots, CDP/browser diagnostics, and
Next.js MCP compilation/runtime errors.

## Genome analysis

Dropping a non-empty `.vcf` or `.vcf.gz` file starts a direct, resumable upload
to IBM. Files can be up to 10 GiB, subject to the backend's admission limits.
Next.js returns only public connection settings from
`GET /api/genome-uploads/config`; file bytes never enter a Next.js request or
become a JavaScript string. `tus-js-client` slices the original `File` into
bounded chunks (normally 8 MiB), retains compression, and resumes using the
server's acknowledged offset. The summary card displays saved bytes with
pause/resume/cancel controls, then queue/streaming progress, the validated
backend summary, and its research disclaimer.

The server uses the documented Python service at
`https://148-100-79-183.sslip.io` by default. Set **server-only** `CRISPR_API_URL`
to another origin, such as `http://localhost:8000`, in `apps/web/.env.local` or
the runtime environment. Turbo passes this runtime value through without adding
it to build hashes; it is read by the route at request time. Restart `bun run dev`
after changing it. The browser reads this public origin from the config route,
then calls IBM directly. Local HTTP is allowed only for loopback development.
The API and tus collection must share an origin, with uploads at `/files/`;
every SDK request is bound to that collection or the current session's exact
resource URL before sending its bearer capability.

The current journey is genome-only: symptoms are empty and `use_llm` is false.
The avatar follows the completed report's optional `genome.model_profile`,
derived from explicit sex metadata for the VCF's selected sample. Missing or
ambiguous metadata uses the default male model without claiming an inference;
replacement uploads reset that choice. The manual profile toggle is removed,
and region highlighting is temporarily disabled by `SHOW_DEV_REGION_CONTROLS`
in `model-workspace.tsx`. The avatar is never treated as patient sex.
Python owns VCF interpretation, panel/inheritance rules, and edit planning;
the frontend never opens the database or invents findings.

Completed reports expose `genome_view`: versioned GRCh38, zero-based half-open
intervals, reference/alternate alleles, tiered annotations and bounded forward
reference contexts. The right pane uses that map for red minimap markers and
matching 3D base highlights. Marker clicks or finding entries switch chromosome
and jump directly; native minimap scrubbing and DNA scrolling synchronize in
both directions. Displayed coordinates are one-based. See
[the coordinate and ownership contract](../../docs/genome-regions.md).

A VCF is not a full DNA sequence. The scene displays backend reference context
and shows alternate alleles separately; uncovered positions are `N`. A no-finding
report has no markers. Older completed reports without a map require reanalysis.
The synthetic source is available only before choosing a file; it is never used
to fill gaps in an uploaded genome. Replacing a file resets explorer navigation,
while pane switches preserve it.

Replacing a file stops its transfer/polling, requests session cancellation, and
discards late callbacks. Closing a pane preserves the file, transfer, report,
and widget order. Unmounting stops browser activity; an already queued durable
job may continue on IBM. Explicit cancel stops local activity immediately and
requests backend cancellation; unreachable sessions are reclaimed by backend
expiry. Completed analyses persist in the browser's IndexedDB database
`crispr-genomes`: one validated, versioned record contains file metadata, report,
progress and the reference contexts used by the DNA viewer. Refresh restores
that result without network requests or re-uploading. Raw VCF bytes and upload
capabilities are not cached, keeping recovery independent of file size. Active
upload/polling sessions remain in memory; pause/network recovery works in the
current page. Replacing or removing the genome invalidates the saved result.
The summary's Remove genome action clears it, and unavailable browser storage
produces a notice while the current analysis remains usable.

The tus SDK owns bounded transport retries and offset reconciliation. Completing
an upload is idempotent, and failed processing retries reuse the existing stored
file through the backend's explicit, bounded `/retry` operation. The UI reports
actual records/bytes scanned rather than estimating processing percentages.
The compatibility `POST /api/analyze` route remains limited to 20 MiB; it is not
used by this browser flow. Telemetry must exclude genome contents, filenames,
bearer tokens, and reports.

## Cloudflare Workers

From the repository root, use `bun run build:worker`, `bun run preview:worker`,
and `bun run deploy`. The app uses OpenNext with standalone Next.js output and
repository-wide file tracing so shared libraries are included. Wrangler and the
adapter are pinned in this workspace. See [deployment ownership, CI settings,
and recovery](../../docs/deployment.md) before changing the release workflow.

## Changelog

### 2026-10-17

- The genome explorer adapts to its pane with container queries: DNA and mutation details share columns above 40rem of content width and stack below it. Keep the DNA display height bounded, selected mutation details outside the findings disclosure, and allele text in the main pane flow; long lists start collapsed with a visible count rather than introducing nested scroll areas. Coordinate axes and sequences remain left-to-right when the surrounding controls mirror for RTL.
- Avatar selection derives from validated `genome.model_profile` metadata rather than a manual toggle. Unknown profiles keep the default visual model; do not infer a female profile from missing Y variants or send the display choice back as clinical sex. Region highlighting remains behind the temporary, disabled `SHOW_DEV_REGION_CONTROLS` switch.
- `genome_view` is the only app-facing finding/sequence contract. Preserve its assembly and BED-compatible intervals end to end; VCF indels include their anchor, and alternate alleles must not shift reference coordinates. The minimap and scene use the same reference spans; carrier annotations retain their distinct tier.
- Real findings replace demo DNA after analysis. Only verified reference windows become sequence; unknown coverage stays `N`, avoiding fabricated patient DNA. Old stored reports need reanalysis to obtain a map. The app owns minimap interactions and the library owns highlight rendering.
- Genome uploads bypass Next.js and use IBM's capability-bound tus sessions, 8 MiB chunks, compressed VCFs, and durable processing jobs. This keeps multi-gigabyte files out of the frontend/Next.js memory path; the former 20 MiB route remains compatibility-only.
- Upload progress counts server-acknowledged chunks, and processing progress counts real scanned records/bytes. Pause/resume keeps one session, completion is idempotent, and processing retries reuse the stored file rather than transferring it again.
- A tus creation conflict offers explicit fresh-session recovery only after the SDK observes a missing resource and no acknowledged bytes. Cancel the old reservation before requesting another id: duplicate tusd file-store creation can truncate an existing file, so resuming a saved resource must always use its acknowledged offset.
- Completed genomes survive refresh through `genome-analysis/cache.ts`, using `idb-keyval` for atomic IndexedDB operations and the existing report/progress schemas at the storage boundary. Keep only one current result, never raw VCF bytes or upload tokens. A delayed restore cannot replace a new selection; replacement/removal invalidates older data, and `data-genome-cached` acknowledges a committed result for deterministic browser verification.

- The genome explorer's Unwind/Rewind button switches between the double helix and a flat ladder without resetting position or fetching sequence again. Mode stays selected across chromosome and pane changes; the library owns the reversible deformation and reduced-motion behavior.

- Production uses `https://crispr.lbxa.net`, declared as a Worker Custom Domain in `wrangler.jsonc` so subsequent releases preserve Cloudflare-managed DNS and TLS.

- The right pane is a full-height genome explorer rather than a reorderable widget. It loads `@crispr/human-model/dna` on first opening and retains its position across pane switches; inactive scenes pause. Chromosome selection, one-based position entry, and the chromosome overview live in the app, while rendering stays in the library.
- Before file selection, the DNA viewer uses a clearly labeled synthetic genome. Analyzed uploads replace it with real GRCh38 finding coordinates and the backend's bounded reference contexts; a VCF is never treated as a complete nucleotide sequence.

- Iterate on UI locally with `bun run dev` at `http://localhost:3000`. Keep changes local unless a production release is explicitly requested: pushing `main` triggers the Cloudflare Workers pipeline.
- Dropping a VCF starts the Python genome-only analysis flow through direct IBM uploads; an independent summary widget appears underneath the file widget. `react-dropzone` owns selection and file limits; the analysis hook owns cancellation and latest-file state; the upload adapter owns transfer/job validation and safe errors.
- The file card is one clickable, keyboard-accessible drop box. Clicking anywhere chooses or replaces a file; keep it free of separate buttons, headers, footers, and persistent device-status copy.
- The empty file card identifies genome variants in VCF format. Hover gently changes the surface; bright mint outlines identify keyboard focus and file dragging. The summary uses Python's own wording and disclaimer; the explicit `genome_view` carries only the coordinates, alleles and reference contexts needed by the explorer, while raw edit plans and symptoms remain at the backend.
- Genome-only requests omit patient sex rather than inferring it from the avatar, and skip symptom extraction with empty symptoms and `use_llm: false`. Results stay paired with the current file across pane switches; late results from replaced files are ignored.
- The left pane contains a `ManagedWidgetGrid` from `@crispr/widget-grid`: small file and local-date cards share its first row, with the full-width analysis summary below. The date follows the browser's local day and refreshes after midnight or returning to the tab. Add widget ids to `defaultOrder` and matching `WidgetGrid.Item` children in `ModelWorkspace`; order stays in memory across pane switches. The right pane reserves its full height for the genome explorer.
- The file widget's small top grip moves the widget; its single drop box chooses/replaces files and opts out of widget dragging. Keyboard users focus the widget to reorder or the drop box to choose a file. Escape first cancels movement, then a later Escape closes the pane. Hidden grids disable and cancel movement while retaining content state.
- From 90rem (1440px at the default root size), both panes can stay open with the avatar between them. The file pane caps at 400px and the studio at 720px; independent width tokens keep transitions stable. Below that content-fit breakpoint, only the last opened pane is visible. Resizing preserves the wider layout's open panes until the user changes them in compact mode. Escape closes the focused pane (or the last opened one) and restores its toggle's focus.
- Both pane scroll areas span the viewport, with 32px of internal vertical breathing room. Keep the app header removed and pane toggles fixed above content; the studio header reserves horizontal space for those controls rather than a separate header band.
- Pane and avatar motion share the existing cubic-bezier timing. Translate the avatar horizontally without scaling its canvas: the canvas must continue reaching the viewport edges when a pane opens. Compact screens give the pane most of the viewport and slide the avatar out of the work area, hiding it after the transition to avoid offscreen keyboard focus. Reduced-motion preferences disable transitions.
- A genome that finishes analysis opens the right pane once per chosen file (a restored, cached genome does not, and a pane the user closes stays closed). Findings pulse on the minimap, in the findings list and on the helix until their region has been in view; reduced motion keeps a static ring instead. The minimap slider is pointer-driven: a visible handle that can be grabbed anywhere on the track, with the native range input kept only for keyboard and assistive tech. The handle ignores the pointer so neighbouring finding markers stay clickable, and a press on a marker selects it on click but scrubs on drag. Clicking a finding or typing a base slides the helix there (the readout and handle follow it); scrubbing tracks the pointer without sliding.
- Cloudflare Workers runs the existing Next.js build through OpenNext; native Workers Builds owns releases from `lbxa/crispr` on `main` after the shared verification gate. Next.js 16.4.1 satisfies the pinned adapter's supported version range.
- Keep the workspace focused on the full-screen anatomy scene. Profile selection follows the genome report and developer region controls are temporarily disabled; avoid restoring explanatory panels, decorative status badges, duplicate headings, or persistent gesture hints.
- Next.js is the primary UI driver; `HumanModel` is a lazily loaded library component so page delivery and future research workflows are independent of WebGL startup.
- React controls own profile and highlight selections; `libs/human-model` owns scene mechanics. This keeps product features out of the GPU lifecycle and gives agents one place to find each behavior.
- Models are copied from the library's hashed build manifest into public assets, allowing static delivery and durable caching without runtime filesystem routes or duplicated source assets.
