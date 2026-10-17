---
name: playwright
description: Implement or debug browser automation in Crispr's existing Playwright/CDP library. For app verification, use the browser-harness skill.
---

# Playwright in Crispr

For app verification, read `../browser-harness/SKILL.md` and use the existing
`@crispr/browser-harness` TypeScript API or JSONL server. Do not create a parallel
Playwright CLI session; it loses the harness's run correlation and evidence.

For harness implementation, inspect `libs/browser-harness/src/browser-session.ts`,
`cdp-session.ts`, and their tests. Use Context7 with the installed Playwright
version for API questions, or installed/official documentation when unavailable.
Keep generic browser lifecycle and CDP handling in the library; app-specific
selectors and user journeys belong in callers.

Run package tests, lint, check-types, and build. Run `bun run verify:browser`
for real Next.js integration. Install the matching Chromium through
`bun run --cwd libs/browser-harness install:browsers` when missing.
