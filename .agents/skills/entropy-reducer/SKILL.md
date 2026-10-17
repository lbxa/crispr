---
name: entropy-reducer
description: Critical end-of-turn and scheduled-maintenance workflow that every agent must run to reduce AI slop and repository entropy. Use after code, test, configuration, behavioral documentation, or architecture changes; during quality sweeps; before final responses; and when scanning for hand-rolled helpers, guessed data shapes, drift from shared packages, weak boundary validation, or targeted refactoring opportunities.
---

# Entropy Reducer

Run this skill at the end of every agent execution that touches repository code, tests, configuration, behavioral documentation, or architecture instructions. Apply a small, repeatable entropy tax that leaves the touched area easier for the next agent to understand, and keep the pass bounded to current changes and nearby code.

## End-of-turn pass

Before the final response, inspect the current diff and nearby touched code for exactly these pressure points:

1. Shared utility packages over hand-rolled helpers
2. Typed or validated data boundaries over guessed data shapes
3. Small targeted refactors over broad rewrites
4. Quality-grade changes caused by the current work

Make an obvious small safe fix now. Rerun the relevant deterministic verification after any fix.

Do not expand the original task for larger cleanup. Record a targeted follow-up with file references, risk, and the smallest recommended refactor instead.

## Shared utilities

Prefer existing shared packages, platform helpers, schema utilities, and local conventions over new one-off helpers.

Flag or fix:

- New helpers that duplicate shared behavior
- Copy-pasted parsing, formatting, date, currency, ID, logging, validation, or fetch logic
- Local wrappers that add no ownership, invariants, typing, or boundary clarity
- Repeated ad hoc constants that belong in a shared contract

Allow a hand-rolled helper only when no suitable shared helper exists, the helper is local to one capability, its name captures a domain invariant, and extraction would create more indirection than it removes.

## Data boundaries

Do not build on guessed shapes from console output, loose inspection, arbitrary JSON paths, or hopeful optional chaining.

Prefer typed SDKs, generated types, runtime schemas at untrusted boundaries, narrow adapters from external DTOs to internal types, and explicit unknown or error handling.

Flag or fix:

- `any`, broad casts, or untyped JSON crossing module boundaries
- External payloads accessed directly outside adapters
- Tests asserting guessed shapes instead of contract fixtures
- Fetch, database, or API results consumed without validation or typed clients

## Quality grade

Assign a lightweight grade to the touched area:

- A: Central invariants preserved, shared utilities used, and boundaries typed or validated
- B: Minor duplication or local-helper risk with no guessed external shapes
- C: Repeated helper drift, weak validation, or unclear ownership
- D: Architectural drift likely to compound and needing a targeted refactor

Report a grade only when it changed or deserves follow-up. Avoid ceremony when the pass finds nothing meaningful.

## Background sweep

For scheduled or explicit entropy sweeps:

1. Choose one entropy class: utility duplication, guessed data probing, boundary-validation gaps, or quality-grade drift.
2. Search mechanically first with `rg`.
3. Inspect representative matches before editing.
4. Produce the smallest coherent refactor that can be reviewed in under a minute.
5. Include before-and-after rationale and verification output.
6. State whether the change is safe to automerge after checks.

Do not mix unrelated entropy classes in one change.

## Targeted change standard

Prefer changes that:

- Delete or centralize duplicated helper logic
- Replace guessed shapes with typed SDK use or schema validation
- Move external DTO handling to an adapter boundary
- Update tests to lock the centralized invariant
- Stay small enough to review quickly
- Avoid opportunistic formatting and unrelated cleanup

## Final response

Preserve the job-wide handoff. Integrate entropy findings with the original task summary and verification; never replace the handoff with an entropy-only summary.

End normal task responses with exactly one terse line:

```text
Entropy pass: no new drift found.
```

or:

```text
Entropy pass: fixed duplicated date formatting by reusing the shared formatter; area remains grade A.
```

For scheduled or explicit entropy sweeps, report the entropy class, findings, fixes or plan, grade before and after, verification, and automerge recommendation.
