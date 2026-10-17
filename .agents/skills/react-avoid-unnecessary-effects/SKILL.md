---
name: react-avoid-unnecessary-effects
description: Use when writing, reviewing, or refactoring React components and hooks that use useEffect, derived state, prop-driven resets, event-specific side effects, parent notifications, external stores, subscriptions, timers, data fetching, or cleanup logic. Helps remove unnecessary Effects, fix stale renders or races, and choose render-time derivation, event handlers, keys, useMemo, or useSyncExternalStore instead.
---

# React Avoid Unnecessary Effects

## Core Principle

Effects are an escape hatch for synchronizing a component with an external system: browser APIs, DOM widgets, subscriptions, timers, analytics on display, or network state. If logic only derives UI from existing props/state or responds to a user action, it usually does not belong in `useEffect`.

Before adding or keeping an Effect, answer: "Should this run because the component is visible, or because a specific event happened?"

## Review Checklist

1. If data can be calculated from props/state, calculate it during render.
2. If the calculation is measurably expensive, consider `useMemo`; otherwise avoid memoization.
3. If state should reset for a different entity, key the inner component by that entity ID; do not reset drafts just because the same entity object refreshed.
4. If only part of state needs adjustment, first try storing a stable ID and deriving the selected object during render.
5. If logic is caused by a click, submit, drag, or other interaction, move it into that event handler.
6. If a child pushes fetched data to a parent in an Effect, lift the data fetch to the nearest common parent.
7. If subscribing to mutable external data, prefer `useSyncExternalStore` over hand-rolled subscription state.
8. If fetching in an Effect, include cleanup or cancellation so stale responses cannot win races.

## Common Replacements

| Anti-pattern | Prefer |
| --- | --- |
| `useEffect` sets derived state like `fullName`, `visibleItems`, totals, flags | A render-time `const` |
| `useEffect` filters/sorts props into local state | Render-time calculation, or `useMemo` only when expensive |
| `useEffect` resets all form state when `id` changes | Split the form and pass `key={id}` to the inner component |
| `useEffect` sends POST/notification after state changes from a user action | Call POST/notification in the event handler |
| Chained Effects update state solely to trigger other Effects | Compute next state together in the event handler |
| Child calls parent setter from `useEffect` after fetching | Fetch in the parent and pass data down |
| Manual browser/store subscription in `useEffect` | `useSyncExternalStore` |

## Canonical Example

```tsx
// Avoid: redundant state, stale first render, extra render pass.
const [visibleItems, setVisibleItems] = useState<Item[]>([]);
useEffect(() => {
  setVisibleItems(filterItems(items, filter));
}, [items, filter]);

// Prefer: derived during render.
const visibleItems = filterItems(items, filter);
```

If `filterItems` is proven expensive and unrelated state changes cause re-renders:

```tsx
const visibleItems = useMemo(
  () => filterItems(items, filter),
  [items, filter],
);
```

## Valid Effects

Keep an Effect when the component must synchronize with something outside React:

- Start or clean up a subscription, timer, observer, or non-React widget.
- Report that the component was displayed, such as a page-view analytics event.
- Keep results synchronized with network data for the current query/page, with stale-response cleanup.
- Imperatively coordinate browser APIs or DOM APIs that cannot be expressed in render.

## Red Flags

- "When prop X changes, set state Y" where `Y` can be derived.
- State variables that only mirror other state variables.
- Effects that exist only to call another setter.
- Effects that send event-specific requests after setting a flag.
- Parent and child state kept synchronized from a child Effect.
- Empty dependency Effects used for app initialization that must run once per app load.

When a raw `useEffect` remains, name the external system it synchronizes with. If there is no external system, remove the Effect.
