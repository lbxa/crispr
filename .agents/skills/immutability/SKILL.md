---
name: immutability
description: Apply immutable coding patterns during code design, implementation, refactoring, and review across Python, TypeScript, JavaScript, Java, C#, Go, Rust, Kotlin, and other languages. Use when creating or changing stateful code, shared in-memory data, concurrent or async workflows, reducers, DTOs, domain models, configuration, caches, APIs, or when asked for good and bad examples of immutability, race-condition prevention, copy-on-write, readonly data, frozen data, or immutable update patterns.
---

# Immutability

## Overview

Use immutability as the default posture for shared state, domain values, configuration, API boundaries, reducers, and async or concurrent workflows. Prefer new values over in-place mutation so readers never observe partial updates and callers can reason locally about state changes.

## Workflow

1. Identify ownership first.
   - Treat shared, cached, exported, captured, returned, or cross-thread data as immutable.
   - Allow local mutation only while constructing a value that has not escaped.
   - Publish completed values atomically by replacing the reference, not by mutating the object readers already hold.

2. Preserve the original value.
   - Return a new object, record, dataclass, array, tuple, map, or collection.
   - Copy only the path that changes; keep unchanged children shared when they are immutable.
   - Do not mutate function arguments unless the API name and contract explicitly promise mutation.

3. Make immutability visible in types and constructors.
   - Use `readonly`, `ReadonlyArray`, frozen dataclasses, tuples, records, value objects, and immutable collection types where available.
   - Copy mutable inputs at boundaries before storing them.
   - Avoid exposing internal mutable collections through getters or public fields.

4. Be pragmatic about memory and hot paths.
   - Prefer immutable updates by default; most application paths are not memory-bound enough to justify mutation risk.
   - For large data or hot loops, use local builders, structural sharing, persistent collections, batching, or copy-on-write.
   - Measure before replacing clear immutable code with in-place mutation.

5. Verify the behavior.
   - Add tests that the original value is unchanged after an update.
   - Add tests for aliasing, nested collections, and shared references.
   - For concurrent code, test that readers see either the old snapshot or the new snapshot, never a half-updated value.

## References

Read the smallest relevant reference file before writing language-specific examples:

- `references/python.md`: Use for Python dataclasses, tuples, mappings, copy-on-write updates, mutable defaults, and shared snapshots.
- `references/typescript.md`: Use for TypeScript or JavaScript readonly types, arrays, object spread, frozen boundaries, reducers, and runtime versus type-only immutability.
- `references/cross-language.md`: Use for Java, C#, Go, Rust, Kotlin, or language-agnostic review guidance.

## Review Checklist

- Prefer `withX`, `updatedX`, `copy`, `replace`, or reducer-style functions that return new values.
- Reject hidden mutation of arguments, module globals, singleton config, request-scoped context, or cached objects.
- Reject shallow immutability when nested mutable collections can still be changed through aliases.
- Accept controlled local mutation inside a builder or tight loop only when the value is not observable until returned.
- Mention performance tradeoffs honestly, but do not optimize away immutability without evidence.
