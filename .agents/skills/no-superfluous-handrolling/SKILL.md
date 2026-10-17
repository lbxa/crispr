---
name: no-superfluous-handrolling
description: Use broadly before writing, reviewing, debugging, refactoring, designing, or choosing dependencies for code that may recreate a solved technical capability. Triggers include any custom implementation of generic infrastructure, algorithms, protocols, parsing, validation, serialization, date/time, retries, queues, caching, rate limiting, scheduling, auth, crypto, payments, state machines, diffing, search, migrations, media/PDF/image handling, browser automation, API clients, SDK-like wrappers, CLIs, or integration plumbing. Helps agents avoid superfluous hand-rolling by preferring mature maintained libraries when they reduce correctness, security, edge-case, or maintenance risk, while keeping custom code for domain-specific product logic.
---

# No Superfluous Handrolling

## Overview

Prefer a proven, actively maintained library when the task is a solved technical problem and correctness, security, edge cases, or long-term maintenance matter. Hand-roll only when the repository has a clear ownership reason, the behavior is domain-specific, or the available libraries are unsuitable.

## Decision Rule

Pause before implementing custom logic for common infrastructure capabilities. Ask: "Is this problem already solved by a mature library that this codebase can reasonably depend on?"

Choose a library when most of these are true:

- The behavior has hidden edge cases, security risk, protocol details, concurrency concerns, or format quirks.
- The project does not already own a strong domain-specific implementation.
- A well-maintained library exists in the repo's language ecosystem.
- The dependency footprint is acceptable for the package runtime and deployment target.
- Using the library reduces code that future maintainers must debug.

Keep custom code when most of these are true:

- The behavior is business logic, product policy, or repository-specific orchestration.
- The code is thin glue around existing package APIs.
- The available libraries are stale, abandoned, incompatible, too broad, or poorly typed.
- The implementation is tiny, obvious, and has no meaningful edge-case surface.
- The repository already has a maintained internal package for this capability.

## Library Evaluation

Before adding or recommending a dependency:

1. Check the repo first for existing dependencies, internal packages, and package-specific guidance.
2. If the user asks about a library, framework, SDK, API, CLI tool, or cloud service, fetch current documentation with Context7 before relying on memory.
3. Prefer libraries with active maintenance, reputable ownership, recent releases, typed APIs where relevant, broad adoption, clear docs, and security posture appropriate to the use case.
4. Consider runtime fit: Bun/Node, Python `uv`, Rust Cargo, browser, serverless, edge, native dependencies, bundle size, licensing, and transitive dependency risk.
5. Use the repository's package manager and conventions when adding the dependency.
6. Add focused tests around the integration boundary and the repository-specific behavior, not around the library's internals.

## Red Flags

Treat these as signs custom code is probably wrong:

- Writing a parser with regular expressions for a structured format with existing parsers.
- Implementing cryptography, password handling, token signing, or payment primitives directly.
- Recreating retry/backoff, rate limiting, queues, schedulers, caches, migrations, state machines, or protocol clients.
- Hand-building date/time, timezone, locale, currency, unit conversion, URL, HTML, XML, CSV, PDF, image, or browser automation behavior.
- Copying large algorithmic code from examples instead of depending on a maintained package.

## Implementation Guidance

When using a library, keep the integration narrow and explicit. Let the dependency own the generic hard problem, and let local code own configuration, data mapping, product policy, observability, and error handling.

Do not introduce a pass-through wrapper only to hide the library. Create a local adapter only when it owns a real boundary: multiple production call sites, lifecycle, defaults, telemetry, policy, compatibility shielding, or a test seam for external effects.

If choosing custom code despite an obvious library category, state the reason briefly in the implementation notes or review findings.
