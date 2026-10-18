# Genome web

The Next.js App Router application owns the gene editing software's UI and
navigation. The current page establishes the anatomy workspace; genetic edit
operations and workflow policy should be added at the application boundary.

## Code map

| File                                                       | Owns                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                                             | Server-rendered page shell and built asset URLs                                                    |
| `app/model-workspace.tsx`                                  | React panes, report-driven avatar profile/highlights and lazy `HumanModel`                         |
| `app/genome-analysis/body-map.ts`                          | Supported-region validation and non-carrier red highlight policy                                   |
| `app/file-drop-card.tsx`                                   | Single-file VCF selection, size/type checks, and replacement                                       |
| `app/genome-explorer.tsx`, `app/demo-genome.ts`            | Right-pane DNA navigation and a position-addressable synthetic genome                              |
| `app/karyotype/karyotype-navigator.tsx`                    | Scrollable 46-chromosome karyotype: click-to-jump, pinging finding dots                            |
| `app/genome-analysis/genome-view.ts`                       | Validated BED-compatible map and bounded reference-context source                                  |
| `app/genome-analysis/client.ts`                            | Capability-bound IBM tus transfers, pause/resume, and job polling                                  |
| `app/genome-analysis/use-genome-analysis.ts`               | Workspace upload ownership, cancellation, and latest-file state                                    |
| `app/genome-analysis/cache.ts`                             | Versioned IndexedDB cache of the current genome metadata and report                                |
| `app/genome-analysis/summary-card.tsx`                     | Processing, failure/retry, and backend summary presentation                                        |
| `app/genome-analysis/contract.ts`, `backend.ts`            | Validated report contract and server-only Python API adapter                                       |
| `app/api/genome-uploads/config/route.ts`                   | Public IBM upload origin and bounded transfer settings                                             |
| `app/api/analyze/route.ts`                                 | Compatibility small-file multipart route and safe request telemetry                                |
| `../../libs/widget-grid/README.md`                         | Grid layout, reordering, widget sizing, and interaction contracts                                  |
| `app/page.module.css`, `app/globals.css`                   | App layout and styling                                                                             |
| `app/crispr/crispr-drawer.tsx`, `report.tsx`, `panels.tsx` | Responsive CRISPR report, gene choice and advanced genomics                                        |
| `app/genome-analysis/report.tsx`                           | Complete analysis and per-disease evidence inside shared report drawers                            |
| `app/crispr/contract.ts`, `backend.ts`, `client.ts`        | Validated CRISPR plan contract, server-only adapter for `GET /genes/{gene}/crispr`, browser client |
| `app/api/crispr/[gene]/route.ts`                           | Uncached server route for gene reports; maps backend failures to statuses                          |
| `app/layout.tsx`                                           | Fonts, page metadata, theme provider and shared Sonner Toaster                                     |
| `instrumentation.ts`                                       | Node server observability                                                                          |
| `wrangler.jsonc`, `open-next.config.ts`                    | Cloudflare Worker deployment, bindings, and adapter settings                                       |
| `scripts/sync-model-assets.ts`                             | Copies the library's generated assets into Next's public directory                                 |
| `../../libs/human-model/src/scene.ts`                      | Three.js scene lifecycle, not app policy                                                           |
| `app/genome/page.tsx`                                      | Genome results route: server shell and top navigation                                              |
| `app/chat/page.tsx`                                        | `/chat`: iframe of the workbench built by `@crispr/chat-agent` (copied to `public/workbench/`)     |
| `app/api/chat/route.ts`, `app/api/state/route.ts`          | Chat stream and first-view state from `@crispr/chat-agent`; logs status and latency only           |
| `app/genome/genome-workspace.tsx`                          | Body-system rail, `HumanModel` highlights, panel filters, ask bar                                  |
| `@crispr/ui/genome/*` (`libs/ui`)                          | Summary/edit-plan cards, icons, report types + demo data, styles                                   |

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

The current journey is genome-only: symptoms are empty and symptom extraction is off.
The backend upload worker separately requests Gemini body-region mapping for
non-carrier findings. The validated `body_map` drives red avatar highlights,
deduplicated across diseases, with accessible region labels. The reviewed PKU
association in `@crispr/human-model/anatomy` also supports older reports without
`body_map`. PKU carriers show the associated head/brain region in red with an
explicit `Carrier finding` label; this does not change their clinical tier or
claim current injury. Other unavailable mappings show a reanalysis notice.
Maps persist with the cached report, and replacing/removing a genome clears its
highlights. Disease findings keep the avatar fully visible even without symptom predictions.
The avatar follows the completed report's optional `genome.model_profile`,
derived from explicit sex metadata or a documented reference-sample identifier
for the VCF's selected sample (HG001/NA12878/GM12878 selects female). Other missing
or ambiguous metadata uses the default male model without claiming an inference;
replacement uploads reset that choice. The manual profile toggle is removed,
and manual region controls are removed. The avatar is never treated as patient sex.
Python owns VCF interpretation, panel/inheritance rules, and edit planning;
the frontend never opens the database or invents findings.

Completed reports expose `genome_view`: versioned GRCh38, zero-based half-open
intervals, reference/alternate alleles, tiered annotations and bounded forward
reference contexts. The right pane uses that map for pinging dots on a
horizontally scrolling karyotype (46,XY or 46,XX from `model_profile`) and
matching 3D base highlights. Clicking any point on a chromosome slides the helix
there (or opens that chromosome there); dots and finding entries jump exactly.
Heterozygous findings mark one copy and homozygous findings both, since
`genome_view` carries no phase. A cursor on the karyotype follows DNA scrolling.
Focused chromosomes take Enter (open), Home and End. Displayed coordinates are one-based. See
[the coordinate and ownership contract](../../docs/genome-regions.md).

A VCF is not a full DNA sequence. The scene displays backend reference context
around findings and fills every other position with the GRCh38 reference, fetched
through `/api/reference/[chromosome]` in cached 4,096-base blocks
(`app/genome-analysis/reference.ts`); alternate alleles are shown separately. If
the reference is unavailable, uncovered positions are `N` and the footer says so. A no-finding
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
that result without contacting the upload service or re-uploading. Raw VCF bytes
and upload capabilities are not cached, keeping recovery independent of file size. Active
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

### 2026-10-18

- `/chat` is now served by `/api/chat` (streamed AI SDK UI message chunks) and `/api/state` from `@crispr/chat-agent`, superseding the iframe-only entry below. The iframe stays: the workbench's CSS and render loop are still self-contained. Its page is built by the package (`bun run --cwd libs/chat-agent build`) and copied into `public/workbench/` by `dev`/`build` through `scripts/sync-workbench.ts`; the generated file is ignored rather than committed. When `/api/chat` is unreachable the page answers with the in-page engine and labels the turn "demo answer: backend unavailable"; a 429 or 400 shows the server's message instead. The chat route logs status, latency and error class only, never question text (questions may describe symptoms).
- Real variant data for `/chat` comes from an offline ClinVar import (`libs/chat-agent/README.md`). Without it the page says "Real data unavailable" and runs on the labelled seed graph. On Cloudflare Workers the import file is not readable at runtime yet, so a deployed `/chat` shows the seed fallback until the dataset is bundled.
- The karyotype draws 46,XX or 46,XY from the report's explicit `model_profile`; without it, it follows the avatar's default male profile so the two always agree (it no longer guesses from whether the file has chrY records).
- Incomplete genome analysis and unavailable region maps use Sonner toasts instead of persistent messages in the DNA viewer; keep that center area clear while the left summary owns recovery actions.
- Widget drag handles fade in when the card is hovered and remain visible for keyboard pickup or active movement. Hidden handles ignore pointer events so hovering the gap alone cannot reveal them; hovering the card makes its handle available to grab. Keep the 32px grid gap constant and center handles in that gap above each card; reserve no in-card handle padding and never change dimensions on hover, so square widgets and pane scrolling stay stable.
- Production responses carry a Content-Security-Policy (`next.config.js`): scripts and styles from this origin plus inline (Next.js bootstrap, next-themes) and `'wasm-unsafe-eval'` for the meshopt decoder; connections only to this origin and the upload backend (`CRISPR_API_URL`); no framing, plugins or foreign form targets. Add new external origins there before using them. HSTS, nosniff, frame, referrer and permissions headers apply in every phase; `X-Powered-By` is off. The dev server omits the CSP for hot reload.
- After an upload, positions outside the backend's finding contexts show the GRCh38 reference instead of `N`. This shows reference DNA, not the person's sequence (a VCF lists only differences), so it is not fabricated patient DNA; finding contexts still take precedence and alternate alleles stay separate. The synthetic demo sequence is still never used for uploaded genomes.
- The CRISPR popup no longer has a "Raw API response" disclosure; the plan's JSON stays out of the customer-facing UI (use the network panel or `/api/crispr/{gene}` when debugging).
- `/chat` embeds the static workbench (`public/workbench/index.html`) in a same-origin iframe instead of porting it to React: its CSS and rendering loop are self-contained and would collide with app styles, and the page is still a prototype on an in-page demo engine over illustrative data, not connected to the backend. The iframe is granted `allow="microphone"` for voice input. Rebuild from `prototypes/chat-workbench` (`npm run build:web`) and copy `web/index.html` over the public file; the prototype is deliberately not a Bun workspace so it stays out of turbo and `bun.lock`.
- Keep Wrangler's `keep_names` disabled: name-preservation helpers inside `next-themes` functions escape into its serialized inline script and fail with `__name is not defined`. Verify theme initialization in the Workers preview as well as Next.js.
- Cloudflare's verification tests the fresh-start cache policy: loading the workspace discards a saved genome without contacting the backend. Wait for cache initialization before asserting that state; restoring cached highlights is no longer the default behavior.
- Disease findings stay visible in a two-column grid below the DNA viewer, including findings on other chromosomes. Group variants into one card per disease and keep each mapped location as a direct viewer jump; report drawers retain the full evidence. The loading state mirrors the same two-card row.
- File selection opens the right pane immediately with shadcn skeletons for the viewer, karyotype and finding cards. Uploading, queueing and processing share this pending view; completion swaps in the real report without reopening a pane the user closed. Paused and failed transfers retain their summary recovery controls. `genome-explorer-skeleton.tsx` owns the placeholder composition, including the DNA scene's app-supplied loading fallback.
- Carrier body-association messages belong on the matching finding card rather than over the avatar. Keep the red highlight and explicit carrier context together; only reviewed associations may claim a body region is shown in red.
- Disease cards and completed analyses open `@crispr/ui/report-drawer`: a right-side panel from 768px and a bottom sheet below it. Keep cards concise and render genotype explanations, variant/phenotype evidence, patient-specific CRISPR edits and repair templates in the drawer. Optional validated fields preserve older summaries without inventing missing detail; catalog gene plans remain a separate explicit action. Drawer Escape must leave the underlying workspace pane open.
- Production uses `https://genome.lbxa.net`. Keep the Worker Custom Domain in `wrangler.jsonc` aligned with Cloudflare and the backend upload CORS rules so future releases preserve the hostname and browser uploads.
- The scrollable karyotype replaces the chromosome Select, base-pair input and minimap scrollbar. Keep the Unwind/Rewind control in a vertical toolbar inside the DNA scene, and keep its cursor synchronized with the displayed helix position. Chromosome labels and instant hover tooltips make the compact navigator usable without a second control row.
- Widget cards use surface contrast and soft shadows without a permanent outer border. Retain keyboard-focus, file-drop and error outlines so interaction states remain visible.
- Light mode brightens the avatar by 10% and keeps no-symptom desaturation without darkening it. The `--avatar-filter` and `--avatar-muted-brightness` tokens preserve the original material and dark-mode appearance across both routes.
- The summary's variant count uses compact decimal notation (for example, `3.9M` and `1.2k`); its hover title and accessible label retain the exact count.
- The product is Genome. Both routes share an app-owned wordmark with Apple's native San Francisco system-font stack, falling back to a system sans on other platforms. Keep scientific CRISPR terminology, workspace package names and storage identifiers separate from product branding.
- Disease cards share `@crispr/ui/genome/disease-card` across the main DNA inspector and `/genome` demo dashboard. `app/disease-artwork.ts` maps the 24 panel genes to local generated WebP covers; `public/diseases/README.md` and `generation.json` record their conceptual motifs and prompts. Keep exact alleles/inheritance behind evidence disclosure, preserve coordinate navigation, and keep carrier findings outside editing actions. `/genome` still displays the simulated demo report.
- Light cards use neutral edges and shallow shadows on the `250, 250, 250` canvas, with separate footer/divider tokens. The file pane reserves shadow gutters without shrinking its cards; keep those gutters at zero in dark mode to preserve the original layout and surfaces.
- Light mode remains the default, with the dark theme available through the saved theme control. Keep the `next-themes` provider and root `.dark` selectors aligned so CSS Modules and Tailwind respond together.
- Prefer validated backend `body_map` for automatic avatar highlights. A reviewed PKU display association recovers older reports and labels carrier associations explicitly, because the HG001 benchmark returns a PAH carrier finding rather than affected-genotype PKU. Associated regions bypass no-symptom dimming without changing the report's clinical tier; unknown diseases still require backend mappings.
- DNA view controls live in a vertical toolbar inside the scene, aligned to its starting edge so they stay with the viewer at every pane width. Unwind/Rewind uses the official Hugeicons Stroke Rounded assets in `public/icons/hugeicons` with retained source/license credits; keep the existing mode state, accessible action names and 44px targets when extending the toolbar.

### 2026-10-18

- The avatar no longer tilts: its vertical viewing angle is pinned in `libs/human-model/src/camera.ts`, so dragging up or down can't tip or flip it. Horizontal turning stays unrestricted and the 0.8×–1.25× zoom range stays.

### 2026-10-17

- The avatar turns freely around its vertical axis, with about 12° of tilt (removed on 2026-10-18) and a 0.8×–1.25× zoom range around the fitted framing (`libs/human-model/src/camera.ts`); this supersedes the earlier turn-only lock, and applies to `/genome` too. The "No phenotypic symptoms predicted" notice sits at the vertical middle of the stage, over the body.
- The workspace starts fresh: the left pane is open, the empty file card ("Drop your genome") is the upload invitation, and `useGenomeAnalysis()` discards the saved genome on load (`{ restore: true }` brings the old restore behavior back). Completed analyses are still written to IndexedDB, but nothing reads them back unless restore is enabled.
- The genome explorer keeps the DNA display height bounded and places disease cards beneath the scrollable karyotype, with exact evidence in the report drawer and no nested findings scroll area. Coordinate axes and sequences remain left-to-right when surrounding controls mirror for RTL.
- Avatar selection derives from validated `genome.model_profile` metadata rather than a manual toggle. Unknown profiles keep the default visual model; do not infer a female profile from missing Y variants or send the display choice back as clinical sex. Region highlighting remains behind the temporary, disabled `SHOW_DEV_REGION_CONTROLS` switch.
- `genome_view` is the only app-facing finding/sequence contract. Preserve its assembly and BED-compatible intervals end to end; VCF indels include their anchor, and alternate alleles must not shift reference coordinates. The karyotype and scene use the same reference spans; carrier annotations retain their distinct tier.
- Real findings replace demo DNA after analysis. Only verified reference windows become sequence; unknown coverage stays `N`, avoiding fabricated patient DNA. Old stored reports need reanalysis to obtain a map. The app owns karyotype navigation and the library owns highlight rendering.
- Genome uploads bypass Next.js and use IBM's capability-bound tus sessions, 8 MiB chunks, compressed VCFs, and durable processing jobs. This keeps multi-gigabyte files out of the frontend/Next.js memory path; the former 20 MiB route remains compatibility-only.
- Upload progress counts server-acknowledged chunks, and processing progress counts real scanned records/bytes. Pause/resume keeps one session, completion is idempotent, and processing retries reuse the stored file rather than transferring it again.
- A tus creation conflict offers explicit fresh-session recovery only after the SDK observes a missing resource and no acknowledged bytes. Cancel the old reservation before requesting another id: duplicate tusd file-store creation can truncate an existing file, so resuming a saved resource must always use its acknowledged offset.
- Completed genomes survive refresh through `genome-analysis/cache.ts`, using `idb-keyval` for one atomic, versioned IndexedDB record validated by the report/progress schemas. Persist file metadata, report and DNA reference contexts rather than raw VCF bytes or upload tokens, so restoration stays independent of genome file size; active uploads and job polling remain scoped to the current page.
- Cache restoration must yield to a newer file selection, and restored snapshots must not be written back on mount, which could overwrite another tab's newer result. Replacement/removal invalidates the saved genome; a storage failure keeps the current analysis usable and displays a recovery notice.

- The genome explorer's Unwind/Rewind button switches between the double helix and a flat ladder without resetting position or fetching sequence again. Mode stays selected across chromosome and pane changes; the library owns the reversible deformation and reduced-motion behavior.

- The right pane is a full-height genome explorer rather than a reorderable widget. It loads `@crispr/human-model/dna` on first opening and retains its position across pane switches; inactive scenes pause. Karyotype selection and coordinate navigation live in the app, while DNA rendering stays in the library.
- Before file selection, the DNA viewer uses a clearly labeled synthetic genome. Analyzed uploads replace it with real GRCh38 finding coordinates and the backend's bounded reference contexts; a VCF is never treated as a complete nucleotide sequence.

- Iterate on UI locally with `bun run dev` at `http://localhost:3000`. Keep changes local unless a production release is explicitly requested: pushing `main` triggers the Cloudflare Workers pipeline.
- Dropping a VCF starts the Python genome-only analysis flow through direct IBM uploads; an independent summary widget appears underneath the file widget. `react-dropzone` owns selection and file limits; the analysis hook owns cancellation and latest-file state; the upload adapter owns transfer/job validation and safe errors.
- The file card is one clickable, keyboard-accessible drop box. Clicking anywhere chooses or replaces a file; keep it free of separate buttons, headers, footers, and persistent device-status copy.
- The empty file card identifies genome variants in VCF format. Hover gently changes the surface; bright mint outlines identify keyboard focus and file dragging. The report drawer uses Python's wording and disclaimer; `genome_view` carries the coordinates, alleles and reference contexts needed by the explorer, and validated edit plans and symptom evidence are retained for the full report.
- Genome-only requests omit patient sex rather than inferring it from the avatar, and skip symptom extraction with empty symptoms and `use_llm: false`. Results stay paired with the current file across pane switches; late results from replaced files are ignored.
- The left pane contains a `ManagedWidgetGrid` from `@crispr/widget-grid`: small file and local-date cards share its first row, with the full-width analysis summary below. The date follows the browser's local day and refreshes after midnight or returning to the tab. Add widget ids to `defaultOrder` and matching `WidgetGrid.Item` children in `ModelWorkspace`; order stays in memory across pane switches. The right pane reserves its full height for the genome explorer.
- The file widget's small top grip moves the widget; its single drop box chooses/replaces files and opts out of widget dragging. Keyboard users focus the widget to reorder or the drop box to choose a file. Escape first cancels movement, then a later Escape closes the pane. Hidden grids disable and cancel movement while retaining content state.
- From 90rem (1440px at the default root size), both panes can stay open with the avatar between them. The file pane caps at 400px and the studio at 720px; independent width tokens keep transitions stable. Below that content-fit breakpoint, only the last opened pane is visible. Resizing preserves the wider layout's open panes until the user changes them in compact mode. Escape closes the focused pane (or the last opened one) and restores its toggle's focus.
- Both pane scroll areas span the viewport, with 32px of internal vertical breathing room. Keep the app header removed and pane toggles fixed above content; the studio header reserves horizontal space for those controls rather than a separate header band.
- Pane and avatar motion share the existing cubic-bezier timing. Translate the avatar horizontally without scaling its canvas: the canvas must continue reaching the viewport edges when a pane opens. Compact screens give the pane most of the viewport and slide the avatar out of the work area, hiding it after the transition to avoid offscreen keyboard focus. Reduced-motion preferences disable transitions.
- Added `/genome`, a Superpower-style results dashboard: body-system rail, the 3D twin highlighting the selected finding, summary, the 24-disease panel with search and filters, and the edit-plan concept. It renders `DEMO_REPORT` until it reads a backend `/orders/{id}` report; its light/dark tokens are scoped to the route so `/` keeps its theme. The cards, icons, report data and styles live in `libs/ui` (`@crispr/ui/genome/*`, added to `transpilePackages` for its CSS module); the 3D workspace stays in the route. The 3D model now only turns horizontally at a fixed zoom (pinned in `libs/human-model/src/camera.ts`).
- Cloudflare Workers runs the existing Next.js build through OpenNext; native Workers Builds owns releases from `lbxa/crispr` on `main` after the shared verification gate. Next.js 16.4.1 satisfies the pinned adapter's supported version range.
- Keep the workspace focused on the full-screen anatomy scene. Profile selection follows the genome report and developer region controls are temporarily disabled; avoid restoring explanatory panels, decorative status badges, duplicate headings, or persistent gesture hints.
- Next.js is the primary UI driver; `HumanModel` is a lazily loaded library component so page delivery and future research workflows are independent of WebGL startup.
- React controls own profile and highlight selections; `libs/human-model` owns scene mechanics. This keeps product features out of the GPU lifecycle and gives agents one place to find each behavior.
- Models are copied from the library's hashed build manifest into public assets, allowing static delivery and durable caching without runtime filesystem routes or duplicated source assets.
- The floating label beside the helix names the disease zone once it is within `ZONE_NEAR_BASES` of the focus line, positioned from `BASE_PIXELS` per base so it tracks the zone as it scrolls past. Zones with a likely or possible finding carry a CRISPR button that opens the report drawer on that gene; carriers get the label only, since a carrier is not an editing target. The gene list is the genome's own identified genes.
- Catalog CRISPR plans come through `/api/crispr/[gene]` and are validated by `crispr/contract.ts`, including repair templates shown in the detailed report. `CRISPR_PLAN_API_URL` can point plans at a different backend than genome analysis (it defaults to `CRISPR_API_URL`). Do not substitute catalog targets for the analyzed genome's own edit results.
- After a genome finishes analysis, the avatar dims and a rounded notice reads "No phenotypic symptoms predicted" unless the report's optional `predicted_symptoms` has entries. The backend does not send that field yet, so today every analyzed genome shows the notice; it clears itself once the backend starts sending predictions.
