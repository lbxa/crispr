---
name: avoid-useless-wrappers
description: Use when writing, refactoring, or reviewing code that adds or extracts a function, class, module, adapter, helper, factory, service, or abstraction. Enforces the VALUE_ALPHA rule against one-off wrappers, pass-through helpers, unnecessary extraction, premature composition, and abstractions that are not reused or do not own a real boundary, invariant, lifecycle, policy, integration, or side effect.
---

# Avoid Useless Wrappers

Use this skill when writing, refactoring, or reviewing code that introduces a
new function, class, module, adapter, helper, or abstraction.

## Core Rule

Do not wrap a block of code in a function, class, module, or helper just to make
the surrounding code look organized.

Extraction is allowed only when the extracted unit has at least one real reason
to exist:

- It has two or more real production call sites.
- It owns a meaningful boundary, lifecycle, invariant, policy, integration, or
  side effect.
- It gives a domain concept a clear name that callers should depend on.
- It removes complex duplication that would otherwise drift.
- It creates a necessary test seam around slow, hostile, or external behavior.

If none of those are true, keep the code inline at the call site.

## Review Checklist

Before adding or approving an abstraction, answer:

- Where is this referenced from production code?
- What decision, invariant, lifecycle, or boundary does it own?
- Would deleting this wrapper make the code easier to read?
- Is the name adding domain meaning, or only restating the implementation?
- Is it hiding important control flow from the caller?

If the only justification is "cleaner", "tidier", "more reusable later", or
"keeps the method short", do not extract it.

## Refactoring Direction

When you find a useless wrapper:

1. Inline it into the single caller.
2. Delete the wrapper.
3. Keep tests at the behavior boundary, not at the deleted wrapper.
4. Reintroduce an abstraction later only when reuse or ownership becomes real.

Prefer direct, readable code over premature composition.

## Creation Circumstances

When code exists to create, configure, or assemble something, use an explicit
factory pattern instead of an anonymous helper or vague wrapper.

A factory is appropriate when creation has real ownership, such as:

- choosing defaults
- honoring environment or parent-process configuration
- assembling dependencies
- returning lifecycle handles
- isolating platform or integration construction

Name the pattern directly. Prefer names like `ImageLibObservabilityFactory`,
`createImageTransformer`, or `catalogueSyncJobFactory` over names like
`setupThing`, `initStuff`, or `buildOptions` when the code owns creation.

Do not create a factory just because construction exists. Inline simple
construction at the call site unless the factory owns a real creation policy or
has multiple production call sites.

## Acceptable Wrappers

These are usually valid even with one direct caller:

- Entry-point lifecycle ownership, such as startup/shutdown coordination.
- Factories that own creation policy, default selection, dependency assembly, or
  lifecycle handle creation.
- Boundary adapters around external services, databases, network calls, or
  platform APIs.
- Domain policies with names the business uses.
- State transition guards or validation that enforce invariants.
- Test seams for nondeterministic or expensive behavior.

The burden is on the wrapper to prove its purpose.
