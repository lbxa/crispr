---
name: code-craftsmanship
description: "Sets a professional standard for coding work: keep scope tight, keep systems clean, and prove important behavior with tests. Use when planning, implementing, refactoring, or reviewing code."
---

# Code Craftsmanship

## Core Rule

Do not produce low-quality work. Quality is not optional. The fastest way to move is to keep the system clean.

## Working Standard

Use this sequence for any coding task:

1. Restate the goal and exact scope before changing code.
2. Identify the precise files to touch and keep the change local.
3. Choose the simplest design that satisfies the real requirement.
4. Prefer clean boundaries, small functions, and readable control flow.
5. Add or update tests for critical behavior before or with the implementation.
6. Refactor within scope when clarity or maintainability directly affects the task.
7. Verify the result and check downstream impact before declaring success.
8. Apply the same standard on every change; craftsmanship is a habit, not a cleanup phase.

## Non-Negotiables

- Do not justify bad code with deadlines or pressure.
- Do not treat deferred cleanup as a real plan.
- Do not ship tangled, unclear, or untested critical logic.
- Do not add speculative abstractions or purity-driven complexity.
- Push back when a request requires knowingly poor engineering.

## Testing Discipline

- Tests are how you prove correctness, not paperwork after the fact.
- Test behavior that would be costly, risky, or hard to debug if wrong.
- Use tests to force thinking before coding whenever the behavior is important.
- If the code is awkward to test, reconsider the design.
- If something critical is not tested, say so explicitly.

## Observability Discipline

If a service, job, workflow, harness, or runtime path is not observable, the
implementation is not complete. Future agents need enough telemetry to diagnose
what happened without rediscovering the system from source and terminal scraps.

Use `@crispr/observability` from `libs/observability` for server and harness
telemetry. Next.js configures it in `apps/web/instrumentation.ts`; reusable
libraries inherit the parent configuration through `configureOnceFromEnv`.
Use structured, stable event names and carry `harness_run_id`, `task_id`, and
`session_id` through long-running operations. See `docs/agent-harness.md`.

Instrument meaningful runtime behavior:

- Startup, shutdown, and configuration decisions.
- Request, workflow, job, harness, and item-level lifecycle start and finish.
- External calls, persistence operations, retries, fallbacks, and skipped work.
- State transitions, gate decisions, validation failures, and policy outcomes.
- Errors with typed cause, safe context, outcome, and next diagnostic clue.

Prefer structured context over prose and low-cardinality fields over unbounded
payloads. Never log secrets, authorization headers, cookies, private user
content, raw media, or third-party API payloads. Redaction is a backup guard,
not permission to pass unsafe fields.

Before finishing runtime-impacting work, ask whether a future maintainer can
identify what happened, which operation it affected, and why it failed or
succeeded from the available diagnostics.

## Professional Filter

Before finishing, ask:

- Is this the smallest clean change that works?
- Will the next engineer understand it quickly?
- Does this improve long-term velocity instead of borrowing from it?
- Did I prove the important behavior?
- Did I make the runtime behavior observable enough to debug later?
- Did I make trade-offs explicit instead of hiding them?

## Customer Standard

Clean code is not inward-looking. Reliability, clarity, and maintainability are part of the value delivered to the customer.

## Triggers

Apply this skill when:

- planning implementation work
- writing or modifying code
- refactoring code that affects the task
- reviewing code quality, correctness, or maintainability
