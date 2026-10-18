# Crispr UI

Shared shadcn/ui primitives live in `src/components`, exported as
`@crispr/ui/components/<name>`. `dialog` is a Base UI modal (focus trap, Escape, backdrop) used by the CRISPR popup. `button` and `card` also retain their shorter
package import paths. App-specific widgets and file selection belong in
`apps/web`, not this library.

The workspace uses the official `base-nova` registry with Base UI and Lucide.
Run `bunx --bun shadcn@latest add <component>` from `apps/web`; matching
`components.json` files route primitives here. Read generated files and declare
their dependencies in this package, since the CLI can omit transitive primitive
dependencies. Components use the maintained `cn` package directly.

Tailwind v4 compiles these sources through `apps/web/app/globals.css`, which owns
the graphite and mint semantic theme. Keep pane backgrounds transparent; only
cards have surfaces. Preserve the app's existing CSS Module layout.

## Changelog

### 2026-10-17

- Replaced the Turbo starter Button and Card with official shadcn primitives and added Empty. Matching app/library registry configuration keeps future components in the shared workspace while product widgets remain app-owned.
- Theme utilities map to the existing Crispr palette, including separate Tailwind accent/muted mappings because the app's original tokens represent mint and muted text rather than utility backgrounds.
