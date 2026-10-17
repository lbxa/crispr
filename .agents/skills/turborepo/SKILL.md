---
name: turborepo
description: Configure or debug the Crispr Bun/Turborepo task graph, workspace dependencies, caching, and package-specific pipelines using installed version-matched documentation.
---

# Turborepo in Crispr

Resolve the installed package from the relevant workspace:

```sh
bun -p "require.resolve('turbo/package.json')"
```

Read its sibling `docs/README.md`, then only the relevant configuration/task/
caching pages. Installed docs are authoritative for this version. Use Context7
for remaining version-sensitive questions if available.

This repo uses `apps/*` and `libs/*`; shared packages are `@crispr/*`. Declare
internal dependencies with `workspace:*` and run `bun install` at the root after
manifest changes. There is one root lockfile. Generic examples in supporting
references may use other folder names; adapt them to this layout.

Package scripts own implementation commands; root scripts invoke Turbo. Builds
depend on `^build` and cache `dist/**` or the Next.js output. Type checks that
consume compiled packages depend on upstream builds. `apps/web/turbo.json` orders
its build before type generation to avoid concurrent writes to `.next/types`.
Tests are uncached. Browser runtime verification is explicit and outside Stop
hooks to avoid contention with an agent's interactive Next.js server.

After changing the graph, inspect `bunx turbo run <task> --dry=json`, then run the
relevant command and `bun run verify`. Check outputs and env declarations so
cached results remain valid. Do not put JSONL `serve` behind the workspace filter
runner; invoke the harness package directly to preserve stdin.
