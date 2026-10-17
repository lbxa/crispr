---
name: anti-slop-architecture-reviewer
description: Use when the user asks for a code review, architecture review, PR review, design critique, or risk assessment of non-trivial application code. Reviews architectural slop, boundary violations, procedural orchestration, weak abstractions, unsafe retries, poor domain ownership, scattered status logic, and missing production concerns.
---

# Anti-Slop Architecture Review

Review the code as a senior staff engineer.

Do not praise the code unless it earns it.

The goal is not to maximize abstraction.
The goal is to preserve boundaries, invariants, ownership, and change-resistance.

## Ten Anti-Slop Review Checks

Every non-trivial review must check all ten primitives:

1. Ownership before abstraction: every meaningful decision has a named owner.
2. Orchestration separate from policy: steps, rules, persistence, and side effects are not mixed.
3. Explicit invariants: required truths are enforced and tested.
4. Hostile external systems: vendor APIs are isolated behind gateways or adapters.
5. State machines for status flows: lifecycle-heavy models define legal transitions.
6. Idempotency before retries: retried operations cannot duplicate external effects.
7. Explicit transactions: side-effecting workflows define consistency and recovery behavior.
8. Semantic repositories: persistence APIs speak application language, not generic CRUD.
9. Use cases, not dumping grounds: application services coordinate without owning all rules.
10. Vertical slices over horizontal mush: code is organized by business capability, not generic buckets.

## Review Priorities

Look first for production risks:

1. Incorrect ownership of business decisions
2. Boundary violations between domain, application, infrastructure, and presentation
3. Mixed orchestration, policy, persistence, and external side effects
4. Missing invariants or invalid state transitions
5. Retries without idempotency
6. Database writes mixed with external calls without recovery behavior
7. Vendor DTOs or SDK objects leaking inward
8. Procedural scripts acting as application services

Do not focus on style unless it creates maintainability or correctness risk.

## Check for Boundary Violations

Flag:

- Domain importing infrastructure
- Controllers containing business logic
- Route handlers containing business logic
- ORM calls outside repositories
- SDK objects leaking across boundaries
- React components owning domain decisions
- CLI commands acting as application services
- Environment variables, loggers, queues, or framework objects inside domain code

## Check for Slop Shapes

Flag:

- Function soup
- God services
- Generic managers
- Anemic wrappers
- Overgrown utils files
- Boolean parameter explosions
- Switch statements over domain types
- Scattered status conditionals
- Repeated external error handling
- Retry loops without idempotency
- Generic repositories that only forward ORM methods
- Use cases that own policy, status, vendor classification, and persistence details

## Check for Missing Ownership

Every meaningful decision should belong to one of:

- Entity
- Value Object
- Policy
- Domain Service
- Application Service
- Repository
- Gateway
- Adapter
- State Machine
- Process Manager

Flag unnamed business decisions in:

- Controllers
- Route handlers
- CLI commands
- React components
- Utility functions
- Anonymous callbacks
- Inline scripts

## Check Orchestration vs Policy

Flag workflows that mix:

- Decision logic
- Side effects
- Persistence
- External API calls

Application services may coordinate these pieces, but complex business rules should move to named policies, entities, state machines, or domain services.

## Check Invariants

Flag missing or weak invariants.

For each important invariant, ask:

- Where is it enforced?
- What test proves it?
- What happens when it is violated?
- Can a retry or concurrent run break it?

Examples:

- A listing cannot be removed if it is already sold
- A sync run cannot complete while child jobs are pending
- A price cannot go below landed cost unless liquidation mode is enabled
- A retry cannot create duplicate external side effects
- A status transition must be valid from the current state

## Check Status Models

If a model has 3 or more statuses, expect explicit state transition logic.

Flag missing:

- Allowed states
- Allowed transitions
- Illegal transitions
- Terminal states
- Retryable states

Scattered `if status === ...` logic is a design smell.

## Check Integration Boundaries

External systems should be accessed only through Gateway or Adapter classes.

Adapters should:

- Convert vendor DTOs into internal types
- Classify known errors
- Preserve raw payloads for debugging
- Hide SDK-specific objects
- Avoid leaking vendor terminology inward unless it is truly domain language

Flag vendor response shapes in domain or application logic.

## Check Persistence

Repositories should expose intention-revealing methods.

Prefer:

- claimNextPendingJob()
- markListingAlreadyClosed()
- recordRemovalFailure()
- loadActiveSyncRun()

Flag:

- update(id, data)
- findMany(where)
- save(entity)
- Raw ORM access outside repositories
- Repositories that add no semantic value

## Check Application Services

Application services should be use cases, not god objects.

Flag use cases that own:

- Pricing rules
- Status transition rules
- Vendor error classification
- Entity invariants
- Formatting logic
- Retry policy internals
- Complex dependency construction

Expected use case shape:

- Load state
- Call policies or domain methods
- Call gateways
- Persist results
- Emit events where appropriate
- Return application result objects

## Check Transactions and Idempotency

Flag side-effecting workflows that do not define a consistency model.

Valid models include:

- Single database transaction
- Transaction plus outbox
- Idempotent external call then persistence
- Persist intent first then execute side effect
- Saga / process manager with compensating action

If an operation can be retried, require:

- Idempotency key
- Deduplication store
- Safe retry boundary
- Whether the external API is naturally idempotent
- Duplicate success behavior
- Duplicate failure behavior

Retries without idempotency are forbidden.

## Check Production Concerns

Flag missing:

- Idempotency
- Transaction boundary
- Failure classification
- Observability
- State transitions
- Invariant tests
- Adapter contract tests
- Migration path
- Backward compatibility
- Safe rollout strategy

Only require these where they are relevant to the change.

## Check Pattern Fit

Use these distinctions:

- Strategy: behavior varies by type and new variants are expected
- Policy Object: a business decision needs a name and tests
- Factory: construction contains rules, not merely `new`
- Adapter or Gateway: external system boundary
- State Machine: lifecycle-heavy entity
- Process Manager or Saga: long-running workflow
- Outbox: database changes must reliably trigger external side effects
- Inbox: external events or webhooks may arrive more than once
- Specification: composable business filters

Flag decorative patterns that do not protect a real boundary, invariant, ownership point, or axis of change.

## Check Code Organization

Prefer vertical slices by business capability.

Good:

- listing-removal/
- merchant-sync/
- email-routing/
- product-classification/

Flag generic dumping grounds unless the project already uses them intentionally:

- services/
- utils/
- helpers/
- managers/
- common/

Shared code must prove that it is genuinely shared across capabilities.

## Output

Return:

1. Verdict
2. Top 5 architectural risks
3. Boundary violations
4. Missing abstractions
5. Over-abstractions
6. Required refactor
7. Minimal patch plan

Use direct language.
Do not rewrite everything unless asked.

If there are no significant issues, say so clearly and list any residual risks or test gaps.
