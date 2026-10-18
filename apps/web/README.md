# Crispr web

The Next.js App Router application owns the gene editing software's UI and
navigation. The current page establishes the anatomy workspace; genetic edit
operations and workflow policy should be added at the application boundary.

## Code map

| File                                     | Owns                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `app/page.tsx`                           | Server-rendered page shell and built asset URLs                    |
| `app/model-workspace.tsx`                | React profile/region selection and the lazy `HumanModel` import    |
| `app/page.module.css`, `app/globals.css` | App layout and styling                                             |
| `app/layout.tsx`                         | Fonts and page metadata                                            |
| `instrumentation.ts`                     | Node server observability                                          |
| `app/genome/page.tsx`                    | Genome results route: server shell and top navigation              |
| `app/genome/genome-workspace.tsx`        | Body-system rail, `HumanModel` highlights, panel filters, ask bar  |
| `@crispr/ui/genome/*` (`libs/ui`)        | Summary/edit-plan cards, icons, report types + demo data, styles   |
| `wrangler.jsonc`, `open-next.config.ts`  | Cloudflare Worker deployment, bindings, and adapter settings       |
| `scripts/sync-model-assets.ts`           | Copies the library's generated assets into Next's public directory |
| `../../libs/human-model/src/scene.ts`    | Three.js scene lifecycle, not app policy                           |

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

Browser verification covers model readiness, both profiles, region selection,
screenshots, CDP/browser diagnostics, and Next.js MCP compilation/runtime errors.

## Cloudflare Workers

From the repository root, use `bun run build:worker`, `bun run preview:worker`,
and `bun run deploy`. The app uses OpenNext with standalone Next.js output and
repository-wide file tracing so shared libraries are included. Wrangler and the
adapter are pinned in this workspace. See [deployment ownership, CI settings,
and recovery](../../docs/deployment.md) before changing the release workflow.

## Changelog

### 2026-10-17

- Added `/genome`, a Superpower-style results dashboard: body-system rail, the 3D twin highlighting the selected finding, summary, the 24-disease panel with search and filters, and the edit-plan concept. It renders `DEMO_REPORT` until it reads a backend `/orders/{id}` report; its light/dark tokens are scoped to the route so `/` keeps its theme. The cards, icons, report data and styles live in `libs/ui` (`@crispr/ui/genome/*`, added to `transpilePackages` for its CSS module); the 3D workspace stays in the route. The 3D model now only turns horizontally at a fixed zoom (pinned in `libs/human-model/src/camera.ts`).
- Cloudflare Workers runs the existing Next.js build through OpenNext; native Workers Builds owns releases from `lbxa/crispr` on `main` after the shared verification gate. Next.js 16.4.1 satisfies the pinned adapter's supported version range.
- Keep the workspace focused on the full-screen anatomy scene. Profile controls stay in a compact dock and region selection opens on demand; avoid restoring explanatory panels, decorative status badges, or duplicate headings.
- Next.js is the primary UI driver; `HumanModel` is a lazily loaded library component so page delivery and future research workflows are independent of WebGL startup.
- React controls own profile and highlight selections; `libs/human-model` owns scene mechanics. This keeps product features out of the GPU lifecycle and gives agents one place to find each behavior.
- Models are copied from the library's hashed build manifest into public assets, allowing static delivery and durable caching without runtime filesystem routes or duplicated source assets.
