---
name: simplify-solution
description: Simplify a proposed solution or existing code and remove proven dead code while preserving behavior and public contracts. Use for focused design assessment, refactoring or cleanup.
---

# Simplify a solution

Compare proposed state, entities, dependencies and abstractions with required scenarios and existing capabilities. Before adding persisted fields or protocols, inspect serialization, restoration and downstream actions. Derive values from existing data when it covers the lifecycle. Keep structured storage when it preserves information that would otherwise be lost.

Choose the smallest solution that preserves failure handling, compatibility, security, accessibility and performance. Keep separation for a concrete responsibility or failure boundary. Do not extract an application framework for a hypothetical second app.

When refactoring, preserve state/effect ownership, public interfaces and the nearest useful shared scope. Update callers and remove superseded definitions. A missing local import does not prove a public export is unused: inspect dynamic references, configuration and documented consumers before deleting it.

Record material choices in the existing plan/design and verify the changed boundary with [build-and-test](../build-and-test/SKILL.md). Reassess only when new evidence changes the decision. Do not broaden cleanup beyond the request.
