---
name: next-cache-components-optimizer
description: Diagnose and optimize static shells and navigation in the Crispr Next.js app when cacheComponents is enabled, using the repo browser harness and framework diagnostics.
---

# Cache Components optimization

Confirm `apps/web/next.config.js` enables `cacheComponents` before applying this
skill. Otherwise use `next-cache-components-adoption` only when enabling it is
within the user's request. Read installed Next.js docs and use Context7 for the
specific caching API or diagnostic under investigation.

Use `../next-dev-loop/SKILL.md` and `../browser-harness/SKILL.md` for runtime
verification. Keep one harness session, a unique run ID, and correlated evidence.
Discover the current `/_next/mcp` tools instead of assuming a browser plugin or
React introspection CLI is installed.

- For first-paint shell problems, read [ppr-loop.md](ppr-loop.md).
- For transitions between routes, read [instant-nav-loop.md](instant-nav-loop.md).

Change one owning route or boundary at a time. Record the observed fallback,
content timing, framework diagnostics, and resulting behavior. Assert the changed
user outcome with snapshots and interactions. Do not infer cache hits or Suspense
ownership from DOM text alone; report missing instrumentation when necessary.
Run `bun run verify` after the runtime loop.
