---
name: occams-razor
description: Chooses the simplest viable solution when multiple implementation options exist by applying first-principles questioning and requirement reduction. Use when designing features, making architectural choices, refactoring, or evaluating competing approaches.
---

# Occam's Razor

## Purpose

Apply this rule whenever there are two or more valid options:

> When deciding between alternatives, pick the simplest solution that still satisfies the real requirement.

This skill is balanced, not rigid:
- Prefer the simplest viable option by default.
- Accept added complexity only when a concrete requirement cannot be met by the simpler path.

## Decision Workflow

Use this sequence before implementation:

1. Define the real goal in one sentence.
2. List constraints that are truly required vs assumed.
3. Generate 2-3 viable options (including the simplest one).
4. Eliminate options that do not meet hard requirements.
5. From the remaining options, choose the one with:
   - fewer moving parts
   - lower maintenance burden
   - smaller change surface
   - easier debugging and rollback
6. If choosing the more complex option, state exactly which requirement forces it.

## First-Principles Questions

Ask these questions explicitly:
- What problem are we actually solving?
- Which requirement is non-negotiable, and which is preference?
- Can we remove a layer, dependency, or abstraction?
- Can existing code be extended instead of introducing new structure?
- What is the smallest change that works safely?

## Output Format

When presenting options, use this format:

```markdown
Goal: <one sentence>

Option A (simplest):
- approach:
- trade-offs:
- meets requirements: yes/no

Option B:
- approach:
- trade-offs:
- meets requirements: yes/no

Decision:
- chosen option:
- why this is simplest viable:
- if not simplest, requirement forcing complexity:
```

## Guardrails

- Do not add abstractions "for future flexibility" without a present requirement.
- Do not introduce new dependencies when existing tooling can solve the problem clearly.
- Do not broaden scope beyond the stated objective.
- Prefer local, reversible, low-risk changes over systemic rewrites.

## Triggers

Apply this skill when:
- there are competing implementation approaches
- architecture or refactor choices are being made
- requirements appear over-specified or assumption-heavy
- a solution feels more complex than the problem
