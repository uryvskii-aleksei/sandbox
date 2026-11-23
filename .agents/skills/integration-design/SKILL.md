---
name: integration-design
description: Design, implement or verify API and data contracts between actual application components or external systems. Use for mappings, synchronization, idempotency and partial-failure recovery. Preserve the chosen providers and hosting runtime.
---

# Integration contracts and recovery

Read the owning app's README, current client/server code, provider documentation and task authority. Use [design-and-docs](../design-and-docs/SKILL.md) for lasting decisions and [build-and-test](../build-and-test/SKILL.md) for verification. An assigned implementer may use this procedure without introducing another role or service.

## Establish the contract

Identify actual systems, owners, API/schema versions, environments and the user operation crossing the boundary. Preserve the requested providers and app runtime. A labelled mapping or mock can answer a bounded question without proving a live connection.

Map meaning before field names: identifier namespace/lifetime, source of truth per entity or field, direction, units/precision, time zone, null versus unknown, deletion and state transitions. Define freshness and conflict rules where data can diverge. Keep local preparation, persisted acceptance and downstream completion distinct.

Classify reads and effects by actual behavior. Identify where an effect commits, how an operation is identified and whether the receiver deduplicates it. State the scope/lifetime of an idempotency key and how a changed payload with the same key is handled. A local deduplication cache alone does not establish exactly-once execution.

## Handle interruption and change

A timeout can precede execution or follow a committed result whose response was lost. Define available status lookup/readback, finite timeout/retry/backoff, cancellation and the stopping point for an unknown outcome. Preserve operation identity across retries. Reconcile before repeating an effect the receiver cannot deduplicate.

For synchronization, cover duplicate or out-of-order events, concurrent versions, partial progress and missed/divergent records when applicable. Explain replay/repair without overwriting newer authoritative data. Choose durable progress storage supported by the real hosting environment, not a speculative queue or persistent process.

For schema or data changes, define old/new compatibility, identity mapping, verification, partial-migration handling and the point where file rollback requires data repair. Keep credentials and customer content out of diagnostics. Live replay, migration and repair require authority for that operation; a general integration design does not grant it.

## Deliver evidence

Return the mapping or assigned adapter with effect boundaries, compatibility, recovery, prerequisites and verification limits. Test meaningful semantic boundaries, duplicates, a lost response after commit, partial success and reconciliation as relevant. Distinguish fixture/mock evidence, real provider sandbox checks and production observations.

Give [UX](../ux-design/SKILL.md) the visible waiting/unknown/recovery states, [QA](../quality-assurance/SKILL.md) acceptance cases and the owning deployment procedure its operational prerequisites. Load those skills only when that part of the task is needed. If the provider cannot establish an outcome, name the unresolved operation and complete independent work.
