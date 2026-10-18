# Crispr UI

Shared shadcn/ui primitives live in `src/components`, exported as
`@crispr/ui/components/<name>`. `report-drawer` composes the Base UI Drawer with responsive direction, a fixed header, scrolling content and a close action. `button` and `card` also retain their shorter
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

### 2026-10-18

- `components/sonner` exports the shared shadcn `Toaster` and `toast` API. Mount the Toaster beneath the app's `ThemeProvider`; it reads the active theme and uses the app's semantic surface tokens.
- Disease cards accept `size="sm"` and app-owned location actions for two-column grids. Compact cards wrap long disease names and coordinate labels, keep full report access, and align their footers without fixed text heights. The demo disease panel also uses two columns.
- `components/skeleton` is the official Base Nova primitive with reduced-motion animation disabled. The app owns placeholder geometry and accessible loading status; keep decorative placeholders out of the accessibility tree.
- `report-drawer` opens from the right on desktop, capped at 30rem (480px), and the bottom below 768px, using `useSyncExternalStore` for media-query changes. Keep mobile sheets full-width. Use its real trigger for focus restoration, and leave report fetching and data policy in the app. The generated Base UI Drawer provides modal focus, gestures and dismissal; the app's body stays positioned for iOS overlays.
- `SelectContent size="sm"` applies compact group/item spacing and bounds long menus to the available height or 18rem. The small trigger keeps its 28px target with 6px horizontal padding; other Select popups retain the default density.
- `genome/disease-card` composes shadcn Card, Badge, Button and the report drawer for both genome views. Keep report adapters, artwork paths, association notices and editing eligibility in the app. Its controlled report action opens details in the drawer; artwork is decorative and never encodes the patient's status.
- Shared `Card` surfaces use app-owned `--card-shadow`, `--card-footer`, and `--card-divider` tokens for depth and neutral inset sections. Cards have no permanent outer ring; retain interactive focus outlines and structural footer dividers. Dashboard cards use the same light elevation treatment, tinted nested tiles, and darker status text.
- Genome dashboard themes follow the app's root `.dark` class rather than system appearance, so the saved light/dark choice remains consistent across routes. Light uses the requested `rgb(250, 250, 250)` page background; the existing dashboard dark palette stays intact.
- Added Base UI Select, Input/InputGroup and Field primitives for dense controls. The small Select uses 28px height and narrow padding; field labels use the existing muted theme, and popup colors resolve through the app's semantic tokens.
- Declare `lucide-react` in this workspace because the shared Select imports it directly; relying on the web app's dependency breaks isolated library type checks.

### 2026-10-17

- Replaced the Turbo starter Button and Card with official shadcn primitives and added Empty. Matching app/library registry configuration keeps future components in the shared workspace while product widgets remain app-owned.
- Theme utilities map to the existing Crispr palette, including separate Tailwind accent/muted mappings because the app's original tokens represent mint and muted text rather than utility backgrounds.
