---
name: anti-slop-code-architecture
description: Use before implementing or refactoring non-trivial application code that involves domain logic, integrations, persistence, async workflows, retries, lifecycle state, external side effects, or long-term maintainability. Enforces a production-grade architecture contract before coding and helps keep ownership, boundaries, invariants, failure modes, and consistency explicit.
---

# Anti-Slop Architecture Mode

You are not allowed to write implementation code until you have produced an architecture contract.

The goal is not to maximize abstraction.
The goal is to preserve boundaries, invariants, ownership, and change-resistance.

Do not force OOP for its own sake. A class is valuable only when it gives a meaningful decision, invariant, policy, integration, or lifecycle a clear home.

## Mandatory Architecture Contract

Before coding, produce:

1. System boundary
2. Core business capability
3. Likely axes of change
4. Domain concepts
5. Invariants
6. Ports and adapters
7. Use cases
8. Failure model
9. Transaction and consistency model
10. Test strategy

If the requested change is small, keep this contract brief.
If the change touches domain logic, persistence, external APIs, retries, async jobs, statuses, workflows, or public behavior, the contract is mandatory.

## Ten Anti-Slop Primitives

Every non-trivial architecture contract must explicitly account for all ten primitives:

1. Ownership before abstraction: every meaningful decision has a named owner.
2. Orchestration separate from policy: steps, rules, persistence, and side effects stay distinct.
3. Explicit invariants: state what must always remain true, where it is enforced, and how it is tested.
4. Hostile external systems: vendor APIs sit behind gateways or adapters and return internal result types.
5. State machines for status flows: models with 3 or more statuses define legal transitions.
6. Idempotency before retries: retried operations define keys, deduplication, and duplicate classification.
7. Explicit transactions: side-effecting workflows define consistency and recovery behavior.
8. Semantic repositories: repositories expose application language, not generic database wrappers.
9. Use cases, not dumping grounds: application services coordinate without owning every rule.
10. Vertical slices over horizontal mush: organize by business capability before generic technical buckets.

## System Boundary

Define:

- What is inside this module
- What is outside this module
- What this module owns
- What this module explicitly does not own

Do not begin implementation while ownership is ambiguous.

## Change Forecast

Identify:

- What is likely to change
- What is unlikely to change
- What would be expensive to change later

Protect likely change points. Do not abstract things just because they exist.

Common marketplace and workflow axes of change:

- Marketplaces will change
- Vendor APIs will fail differently
- Merchant rules will vary
- Listing statuses will multiply
- Retry behavior will become more nuanced
- Operators will need better diagnostics
- Pricing logic will become more strategic
- Sync jobs will need resumability
- Rate limits will become a first-class concern

## Ownership Rules

Every meaningful decision must belong to one of:

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

Do not hide business decisions in:

- Controllers
- Route handlers
- CLI commands
- React components
- Utility functions
- Anonymous callbacks
- Inline scripts

Every meaningful decision must have a named owner.

## Layering Rules

Use this dependency direction:

```text
Presentation -> Application -> Domain
Infrastructure -> Application
Infrastructure -> Domain interfaces only
```

Domain must not import:

- ORM clients
- HTTP clients
- SDKs
- Framework objects
- Environment variables
- Logging libraries
- Queue clients

Application may orchestrate but must not contain complex business rules.

Infrastructure implements ports. It does not own business policy.

## Orchestration vs Policy

Orchestration answers:

> What steps happen, in what order?

Policy answers:

> What should happen, given this state?

All workflows must separate:

- Decision logic
- Side effects
- Persistence
- External API calls

A use case may coordinate these pieces but must not contain business rules directly.

## Domain Model

Before implementation, identify relevant:

- Entities
- Value Objects
- Policies
- State Machines
- Domain Events
- Invariants

Name domain concepts after business meaning, not technical convenience.

## Invariant Rules

Before implementation, list the invariants this code must preserve.

For each invariant, specify:

- Where it is enforced
- What test proves it
- What happens when it is violated

Examples:

- A listing cannot be removed if it is already sold
- A merchant sync run cannot complete if child marketplace jobs are still pending
- A product price cannot go below landed cost unless liquidation mode is explicitly enabled
- A retry cannot create duplicate external side effects
- A status transition must be valid from the current state

## Use Case Rules

Each meaningful operation gets an application service.

A use case may:

- Load state
- Call policies
- Call domain methods
- Call gateways
- Persist results
- Emit events
- Return application result objects

A use case may not:

- Contain pricing rules
- Contain vendor error classification
- Contain status transition rules
- Contain retry algorithms inline
- Directly construct complex dependency graphs

## Policy Rules

If business logic answers "should we", "can we", "how much", "which option", or "what happens next", prefer a named Policy.

Examples:

- RemovalEligibilityPolicy
- PriceFloorPolicy
- RetryEligibilityPolicy
- MerchantSyncPriorityPolicy
- ListingPublicationPolicy

Policies must be deterministic where possible and easy to unit test.

## State Rules

If a model has 3 or more statuses, define explicit state transitions.

The design must specify:

- Allowed states
- Allowed transitions
- Illegal transitions
- Terminal states
- Retryable states

Do not scatter status conditionals across services.

## Integration Rules

External systems must be accessed only through Gateway or Adapter classes.

Adapters must:

- Convert vendor DTOs into internal types
- Classify known errors
- Preserve raw payloads for debugging
- Hide SDK-specific objects
- Avoid leaking vendor terminology inward unless it is truly domain language

Never leak vendor response shapes into domain or application logic.

## Persistence Rules

Repositories must expose intention-revealing methods.

Prefer:

- claimNextPendingJob()
- markListingAlreadyClosed()
- recordRemovalFailure()
- loadActiveSyncRun()

Avoid:

- update(id, data)
- findMany(where)
- save(entity)
- raw ORM access outside repositories

Do not create repositories that only wrap generic ORM calls without adding persistence semantics.

## Transaction Rules

Before coding side-effecting workflows, define the consistency model.

Choose one:

- Single database transaction
- Transaction plus outbox
- Idempotent external call then persistence
- Persist intent first then execute side effect
- Saga / process manager with compensating action

Never mix external API calls and database writes without defining recovery behavior.

## Idempotency Rules

If an operation can be retried, define:

- Idempotency key
- Deduplication store
- Safe retry boundary
- Whether the external API is naturally idempotent
- Duplicate success behavior
- Duplicate failure behavior

Retries without idempotency are forbidden.

## Failure Model

Before implementation, define:

- Known failures
- Retryable failures
- Terminal failures
- Partial success cases
- Compensation behavior
- Observability requirements

External integrations should return internal result types that classify known outcomes and preserve raw unknown payloads.

## Pattern Selection Rules

Use Strategy when behavior varies by type and new variants are expected.

Use Policy Object when a business decision needs a name and tests.

Use Factory when construction contains rules, not merely when calling `new`.

Use Adapter or Gateway for external systems.

Use State Machine for lifecycle-heavy entities.

Use Process Manager or Saga for long-running workflows.

Use Outbox when database changes must reliably trigger external side effects.

Use Inbox when external events or webhooks may arrive more than once.

Use Specification for composable business filters.

Do not use patterns decoratively.

Conditional guidance:

- If conditionals select between stable business behaviors that are expected to grow, use Strategy
- If the conditional enforces a simple invariant, keep it local
- If the conditional represents status transitions, use a State Machine
- If the conditional classifies external errors, use an Error Classifier
- If the conditional chooses construction paths, use a Factory

## Code Organization Rules

Prefer vertical slices by business capability.

Good:

- listing-removal/
- merchant-sync/
- email-routing/
- product-classification/

Avoid dumping code into:

- services/
- utils/
- helpers/
- managers/
- common/

Shared code must prove that it is genuinely shared across capabilities.

## Test Rules

Match tests to the architecture:

- Policy tests for business decisions
- State transition tests for lifecycle rules
- Use case tests with fake ports
- Adapter contract tests for external boundaries
- Integration tests at persistence and API boundaries

Do not rely only on happy-path integration tests when invariants, retries, statuses, or external systems are involved.

## Output Format

For architecture work, output:

1. Architecture overview
2. Boundary map
3. Domain model
4. Pattern choices
5. Interface definitions
6. Implementation plan
7. Failure handling
8. Tests

For implementation work, output:

1. Files to change
2. Architecture contract
3. Code
4. Tests
5. Review checklist

## Failure Conditions

Restart the design if:

- Business logic appears in controllers or route handlers
- Domain imports infrastructure
- External SDK objects leak into domain or application code
- A use case becomes a god class
- Status logic is scattered
- Retries exist without idempotency
- Database writes and external calls are mixed without recovery design
- Utilities contain business behavior
- Pattern usage is decorative rather than necessary
