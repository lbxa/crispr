# Web application

Read `README.md` for the code map, commands, and UI/scene ownership boundary.
Keep `app/page.tsx` a Server Component. Client controls live in
`app/model-workspace.tsx`; load `HumanModel` through its existing dynamic import.
Three.js rendering belongs in `libs/human-model`, not page components.

Use the public `@crispr/human-model` package and lightweight metadata subpaths.
Generated model URLs come from `/asset-manifest`; build the library before
starting the app directly. Do not copy canonical GLBs into source control.
Run `bun run verify` and `bun run verify:browser` for UI/runtime changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
