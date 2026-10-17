---
name: capture-tacit-knowledge
description: Use broadly during repository work when conversation, planning, implementation, debugging, reviews, decision making, or follow-up questions reveal tacit knowledge that future agents should remember. Capture durable decisions, rationale, constraints, rejected alternatives, package ownership, operational rules, integration quirks, domain assumptions, and follow-up answers in the Changelog section of each affected package README.
---

# Capture Tacit Knowledge

## Overview

Preserve durable project memory by recording important tacit knowledge in the relevant package README changelog. Prefer short, decision-centered notes that explain what future agents need to know and why the decision was made.

## Capture Criteria

Capture knowledge when it is durable, package-relevant, and unlikely to be obvious from code alone:

- A decision was made during conversation, planning, debugging, review, or implementation.
- A follow-up answer clarifies intent, ownership, constraints, business rules, or tradeoffs.
- A workaround, rejected alternative, or integration quirk would prevent future re-discovery.
- A package boundary, lifecycle rule, data contract, command convention, or operational invariant changed or became explicit.
- The reason for a change matters as much as the code diff.

Do not capture transient status, obvious implementation detail, generic advice, secrets, credentials, private customer data, speculation, or anything that belongs only in an issue tracker.

## Workflow

1. Identify affected packages from the files, commands, or discussion scope.
2. For each affected package, find the package README. Prefer the nearest `README.md` beside the package manifest or package root. Create `README.md` only when the package has no README and the captured decision is package-specific.
3. Add or update a `## Changelog` section in that README.
4. Add a dated entry using the current local date. Keep entries newest-first unless the README already uses another changelog order.
5. Write concise bullets that include the decision and the reason. Name the package-facing concept, not the conversational path that led to it.

Use this format when the README has no existing changelog convention:

```markdown
## Changelog

### YYYY-MM-DD

- Captured decision: reason future agents should preserve it.
```

## Package Selection

Map knowledge to the narrowest package that owns it:

- App behavior belongs in the affected `apps/<name>/README.md`.
- Shared library contracts belong in the affected `libs/<name>/README.md`.
- Rust crate behavior belongs in the affected `crates/<name>/README.md`.
- Infrastructure decisions belong in the affected `infra/<name>/README.md`.
- Cross-cutting decisions that apply to multiple packages should be duplicated only when each package needs the memory; otherwise place them in the highest-level README that future agents will actually read.

When a task spans multiple packages, add separate package-specific bullets rather than one vague root-level note.

## Writing Standard

Make entries useful to a future agent:

- State the durable decision first.
- Include the reason, constraint, or tradeoff in the same bullet.
- Prefer concrete names: commands, package names, lifecycle states, API boundaries, table fields, and integration names.
- Keep each bullet one or two sentences.
- If the captured knowledge came from the user, phrase it as project fact after applying judgment; do not quote casual conversation unless exact wording matters.

Avoid vague bullets such as:

- "Updated implementation details."
- "Discussed tradeoffs."
- "Use better architecture."

Prefer bullets such as:

- "Catalog delta detection treats `handle` as the stable sync key because source merchant payload ids are not reliable across refreshes."
- "Catalogue CLI argument parsing stays in `@sails/catalogue-lib` so workflows share one prompt/flag contract and avoid divergent parsing behavior."
