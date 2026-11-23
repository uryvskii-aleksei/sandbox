---
name: dev-cycle
description: Research or implement a repository task, select an owned workspace and hand off verified results. Use for a development cycle or substantial implementation. Research alone does not authorize implementation or publication.
---

# Development cycle

Select the requested outcome: investigation, local implementation, PR delivery or publication. Reuse the user's existing authorization and preserve its limits. A repository link supplies context, not a delivery instruction.

1. Read requirements, owning app documentation and existing decisions. Resolve consequential gaps through [design-and-docs](../design-and-docs/SKILL.md).
2. Before writes, select the [owned workspace](references/task-worktree.md). Research without repository edits needs no branch or worktree.
3. Keep a concrete plan in chat, or `## План` in an authorized PR. Do not create empty commits or external objects just to host a plan.
4. Implement the smallest coherent change. Use [simplify-solution](../simplify-solution/SKILL.md) for material design choices. Use [roles and delegation](references/parallel-work.md) only when authorized.
5. Verify the integrated result through [build-and-test](../build-and-test/SKILL.md), including affected consumers and documentation. Review the diff and security boundaries. If independent review is available and warranted, supply a stable snapshot and evidence. Report its absence accurately.
6. For requested PR delivery, follow [github](../github/SKILL.md). For requested hosting publication, follow [timeweb](../timeweb/SKILL.md). A PR request does not implicitly include merge or deployment.
7. Report implemented behavior, checks, local/remote state and unfinished work. Save a [handoff](../design-and-docs/references/handoff.md) when work will continue later.

An investigation ends with evidence, a recommendation and next action. Continue into implementation only when the request includes it. Do not require a new chat or artificial stage approval for work already authorized.
