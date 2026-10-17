---
owner: engineering
authority: canonical
scope: libs/exhaustiveness
---

# @crispr/exhaustiveness

`@crispr/exhaustiveness` is the repository-wide home for exhaustive
control-flow enforcement. Its public API is intentionally frozen to
`assertNever`. It is not a general-purpose utilities or type-safety package.

## Exhaustive switches

Import the shared `assertNever` function instead of defining a local variant:

```ts
import { assertNever } from "@crispr/exhaustiveness";

type State = "ready" | "failed";

function present(state: State): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return assertNever(state, "Unhandled state");
  }
}
```

Adding a member to `State` without adding its switch branch makes the
`assertNever` call fail type-checking. The function also throws with the
supplied context if an impossible value reaches it at runtime.

Runtime parsing remains the responsibility of the boundary that receives
untrusted input. `assertNever` does not validate external data.

## Package boundary

- Public API: `assertNever`.
- Permitted dependencies: none at runtime.
- Prohibited contents: domain vocabulary, application errors, validation
  schemas, framework types, generic parsing helpers, and unrelated utilities.
- Consumers import only from `@crispr/exhaustiveness`.
- Broadening the public API or adding runtime dependencies requires a new
  architecture decision.

## Commands

```sh
bun run lint
bun run check-types
bun run test
```
