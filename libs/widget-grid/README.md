---
owner: engineering
authority: canonical
scope: libs/widget-grid
---

# @crispr/widget-grid

Deterministic placement and accessible, reorderable React widgets for Crispr.
The Next.js workspace uses a managed grid in its transparent left pane; the
right pane reserves its full height for the genome explorer.
Widget content and product behavior stay in `apps/web`; this library owns packing,
movement, order reconciliation, and optional order persistence.

## Code map

| File                                     | Owns                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Immutable packing, reorder targets, tail placement, and order reconciliation             |
| `src/react.tsx`                          | Controlled `WidgetGrid`, pointer/touch/keyboard lifecycle, responsive `WidgetCard` slots |
| `src/managed-react.tsx`                  | `ManagedWidgetGrid` order ownership and optional storage adapter                         |
| `src/react-children.ts`                  | Fragment flattening and widget descriptor recognition                                    |
| `src/styles.css`                         | Card density tokens and named container query tiers                                      |
| `src/*.test.*`                           | Placement, interaction, hydration, and persistence contracts                             |
| `../../apps/web/app/model-workspace.tsx` | Pane membership and application widget composition                                       |

## Consume from Next.js

All entrypoints export source; no library build step is needed. Type checking uses
ESNext/Bundler resolution, matching its Next.js/Vitest consumers. Declare a
`workspace:*` dependency and import public package paths. In the consuming app's
Tailwind 4 stylesheet, include the shared component sources and card tokens once:

```css
@import "tailwindcss";
@import "@crispr/widget-grid/styles.css";
@source "../../../libs/widget-grid/src";
```

Grid focus, drop targets, and cards use the app's semantic `primary`, `ring`,
`card`, `card-foreground`, and radius tokens. They share the graphite/mint theme
with `@crispr/ui`. The grid itself has no background or sidebar shell.

```tsx
import { ManagedWidgetGrid } from "@crispr/widget-grid/managed-react";
import { WidgetGrid } from "@crispr/widget-grid/react";

<ManagedWidgetGrid
  defaultOrder={["files"]}
  disabled={!paneOpen}
  aria-label="Left widgets"
>
  <WidgetGrid.Item id="files" size="normal" label="Files">
    <FileDropCard />
  </WidgetGrid.Item>
</ManagedWidgetGrid>;
```

`defaultOrder` must contain exactly the rendered widget ids, with no duplicates.
Items may be declared directly or inside fragments. Do not hide item descriptors
behind custom components: the grid reads their `id`, `size`, and `label` props.
An empty grid uses `defaultOrder={[]}` and no items.

The application keeps pane grids mounted so their order and widget state survive
pane switches. Set `disabled` while a pane is hidden: this cancels pending or
active movement and removes widget pickup from the tab order. The app owns
visibility and `inert`; disabling the grid only controls movement.

## Placement and order

- `normal` widgets occupy 2×2 cells with even column anchors and can start on
  any row, so a filled row of small cards does not leave a blank row; they may grow
  vertically for intrinsic content. `small` widgets occupy one square cell.
- `wide` widgets occupy 2×1 cells with even column anchors and grow vertically
  with their content, for rectangular forms such as the optional Symptoms card.
- Packing uses earliest-valid first fit and accepts two or four logical columns.
- The React grid measures its container, using two columns below `wideAt`
  (default 640px) and four above it. `gap` defaults to 16px.
- Use named `@container widget-card` queries inside widgets rather than viewport
  breakpoints. `WidgetGrid.Item` and `WidgetCard.Preview` provide the same context.
- `WidgetGrid.Root` is controlled via `order` and `onOrderChange`. The callback
  includes input type, moved id, and old/new positions.
- `ManagedWidgetGrid` owns order in memory unless persistence is explicitly
  configured. Each mounted grid owns a separate session.
- `WidgetGrid.Tail` optionally places an add-widget action after the last item.

## Interaction

Focus a widget and press Space or Enter to pick it up. Arrow keys choose a valid
target, Enter places it, and Escape cancels. Instructions and movement are
available to assistive technology. Committed DOM order follows widget order.
Escape cancels a drag before an enclosing pane or dialog can dismiss itself.

Pointer dragging starts after four pixels. Touch dragging starts after a 260ms
hold so scrolling remains available. Native controls, elements with `role="button"`
or `role="link"`, editable content, and `[data-no-widget-drag]` never initiate
widget movement. For a widget made entirely of interactive content, leave a
noninteractive grip surface inside the item, outside the content. The app's file
widget uses this separation to keep its single drop box clickable.

Reduced motion disables displacement animation and drag target transitions.
Removing or disabling a moving widget cancels movement and clears touch timers.

Pointer/touch drags promote the live item to the browser's top layer using a
manual popover. Its viewport bounds are captured at pickup, and a placeholder
retains its grid footprint. This escapes sidebar scrolling and transformed
ancestors while preserving the same DOM node, React state, inherited theme,
and pointer capture. Drop/cancellation removes the popover and placeholder;
keyboard movement stays in the grid. Consumers require the modern Popover API.

## Card composition

Use `@crispr/ui` cards for existing shadcn widgets. The optional compound
`WidgetCard` slots provide container-aware density for richer widgets:

```tsx
import { WidgetCard } from "@crispr/widget-grid/react";

<WidgetCard.Root>
  <WidgetCard.Header>
    <WidgetCard.Title>Analysis</WidgetCard.Title>
  </WidgetCard.Header>
  <WidgetCard.Body layout="split">{content}</WidgetCard.Body>
  <WidgetCard.Footer>{action}</WidgetCard.Footer>
</WidgetCard.Root>;
```

`WidgetCard.Root` requires a `WidgetGrid.Item` or `WidgetCard.Preview` ancestor.
`Body` supports `flow` and `split`; split becomes two columns when the card is at
least 24rem wide. `CustomBody` bounds charts/media. `Description` hides below
12rem, so essential state belongs in the title, value, or action. For galleries,
wrap the same widget tree in `<WidgetCard.Preview size="normal">`.

## Optional persistence

Pass `persistence={{ key, storage, onError }}` to `ManagedWidgetGrid`. The default
storage adapter resolves `window.localStorage` lazily; a custom synchronous
`WidgetGridOrderStorage` implements `readOrder` and `writeOrder`.

The default order renders during SSR and initial hydration; storage is read once
after commit. Removed and duplicate stored ids are discarded, and new ids are
appended. Invalid data or read/write failures leave the grid working in memory
and are reported to `onError` with the operation, key, and cause.

The browser adapter writes `{ version: 1, state: { preferredOrder } }` and also
reads the legacy `{ version: 1, order }` envelope. Changing the persistence key or
storage adapter identity creates a fresh default-first session. Keep a custom
adapter stable while it represents the same storage boundary.

The web app currently uses memory only; adding persistence later requires an
explicit product decision about user/workspace scope.

## Commands

From the repository root:

```sh
bun run --cwd libs/widget-grid lint
bun run --cwd libs/widget-grid check-types
bun run --cwd libs/widget-grid test
bun run verify
bun run verify:browser
```

## Changelog

### 2026-10-18

- Coverage reports live under `coverage/<vitest-pid>/` so overlapping agent checks cannot delete each other's temporary data. Keep coverage cleaning and thresholds enabled; each run retains its own `coverage-summary.json`.
- `wide` adds a 2×1 footprint for rectangular widgets, using the same packing and drag targets as square cards. Its height grows with form content; small cards retain their fixed square height.

### 2026-10-17

- Large widgets can start on every row while retaining their 2×2 footprint and paired columns. Packing, drag previews and drop targets share this rule, preventing a blank row beneath small cards in narrow panes.
- Lift pointer/touch drags into the native top layer so scrollable panes cannot clip moving widgets. Keep the original item mounted, measure viewport coordinates after scrolling, and reserve its footprint until drop or cancellation.
- Ported the copied library to `@crispr/widget-grid` with shared ESLint/TypeScript configuration, aligned React/tool versions, semantic theme tokens, and the same `cn` utility as shadcn. Layout/gesture ownership stays here; app widget membership stays in `ModelWorkspace`.
- Pane grids retain in-memory order while mounted. Disabling hidden grids cancels movement without unmounting file content or the Three.js scene; no browser storage or cross-pane transfers are enabled by default.
- Custom button/link controls opt out of dragging, and Escape cancels movement before parent dismissal. Committed reading order follows the visual order while stable widget keys preserve content state.
- Hydration uses a cached `useSyncExternalStore` snapshot per keyed session. Storage is read after the default-first UI commits, without render-time ref writes or synchronous state-setting effects; key or adapter changes still create independent sessions.
- Removing a widget cancels its drag before stale targets render; layout cleanup clears pending touch timers before they can restart movement for an unmounted item.

### 2026-07-23

- Added managed order ownership, semantic storage adapters, default-first hydration, and best-effort persistence error reporting.

### 2026-07-21

- Added fixed-footprint packing, pointer/touch/keyboard reordering, responsive card slots, and preview containers.
