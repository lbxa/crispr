---
name: elon-algorithm
description: Applies the Elon algorithm to reduce unnecessary requirements and process before optimization. Use when planning work, prioritizing scope, improving workflows, reviewing operating processes, or deciding what to automate.
---

# Elon Algorithm

## Purpose

Use this skill to remove waste before improving speed or adding tooling.

## Required Order

Follow all five steps in order. Do not skip ahead.

1. Question every requirement.
2. Delete any part of the process you can.
3. Simplify and optimize only what remains.
4. Accelerate cycle time.
5. Automate last.

## Step Workflow

### 1) Question Every Requirement

- Treat each requirement as a suggestion until justified.
- Ask who owns the requirement and what failure it prevents.
- Label each item as `required`, `assumed`, or `historical`.

### 2) Delete Aggressively

- Remove steps, approvals, handoffs, artifacts, and constraints that are not clearly required.
- Prefer subtraction over redesign.
- If nothing is removed, challenge the scope again before moving on.

### 3) Simplify and Optimize

- Only optimize steps that survive deletion.
- Collapse handoffs, reduce dependencies, and keep interfaces minimal.
- Do not optimize anything likely to be deleted next pass.

### 4) Accelerate Cycle Time

- Shorten feedback loops, batch sizes, and decision latency.
- Use smaller iterations and faster checkpoints.
- Measure elapsed time from request to validated result.

### 5) Automate Last

- Automate only stable, repeated, high-value steps.
- Keep newly changed flows manual until they are proven minimal and correct.
- Avoid automating exceptions before the main path is clean.

## Guardrails

- Do not treat inherited process as truth.
- Do not introduce tooling before deletion and simplification are complete.
- Do not scale complexity for hypothetical future needs.
- If a requirement forces complexity, name that requirement explicitly.

## Output Format

Use this compact structure when applying the algorithm:

```markdown
Goal: <one sentence>

Step 1 - Questioned requirements:
- required:
- assumed:
- historical:

Step 2 - Deleted:
- removed:
- kept (with reason):

Step 3 - Simplified/optimized:
- changes:
- why these are worth keeping:

Step 4 - Cycle-time acceleration:
- bottleneck:
- faster loop:

Step 5 - Automation decision:
- automate now:
- keep manual:

Final scope:
- smallest viable process:
- requirement forcing any remaining complexity:
```

## Triggers

Apply this skill when:
- requirements look over-specified or assumption-heavy
- workflow feels slow or process-heavy
- the team is choosing what to cut, simplify, or automate
- a plan needs first-principles reduction before execution
