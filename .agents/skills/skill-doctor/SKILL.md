---
name: skill-doctor
description: Audit agent skills, role contracts and runtime adapters for conflicting rules, poor activation boundaries, stale procedures and unnecessary context. Use for a requested harness audit or a demonstrated instruction/discovery problem, not routine application review or environment diagnostics.
---

# Skill Doctor

Audit the selected instructions as an executable workflow: which request activates them, what the agent may do, which sources it reads and what evidence establishes completion. Start from [AGENTS.md](../../../AGENTS.md) and the [harness catalog](../../README.md). Historical imports are evidence, not active policy.

## Establish the scope

Distinguish an audit, a proposed repair and an authorized edit. An audit does not itself publish changes, deploy an application, run paid provider calls or launch other agents. Reuse existing task authority without adding another approval stage.

Start with the affected canonical skill, its references and direct callers. Expand to neighboring skills, roles or adapters only when activation overlaps or a rule depends on them. For a full harness audit, inventory `.agents/skills/`, `.agents/roles/` and their runtime adapters. Do not load every application manual or private runtime file by default.

## Review the contracts

| Boundary                | Evidence to inspect                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation              | Does the name/description identify a real task? Compare a realistic matching request with a nearby request that should not activate it. Check collisions with neighboring skills.                                                 |
| Rule ownership          | Keep common policy in AGENTS, procedures in skills and responsibility in roles. Find conflicting copies and stale references to another project's services, brand or task process.                                                |
| Task authority          | Preserve the requested outcome and already granted permission. Watch for research becoming implementation, explicitly local work being pushed, or generic rules blocking an authorized delivery step.                             |
| Runtime and adapters    | Compare canonical names, frontmatter, pointers and optional UI metadata. A role file does not prove isolation, model inheritance, delegation permission or a working hook. Preserve personal model/tool settings.                 |
| Executable procedure    | Follow a claimed command to the actual manifest, script or workflow. Check the owning app's stack, hosting, destination and recovery contract. Do not assume every app uses the same backend or deployment helper.                |
| Context and maintenance | Keep decision-changing guidance in the entrypoint. Move conditional detail to linked references, remove proven duplication and preserve required attribution/licenses. Do not split files or add roles merely to meet a template. |

Support a finding with a concrete trigger, file location, conflicting instruction or observed failure, and its consequence. Different wording alone is not a conflict. A missing optional integration or a hypothetical future feature is not a defect.

## Validate what can be observed

- `npm run check:harness` checks local links, configuration, skill pointers, role adapters and static hosting mappings. Passing it does not establish instruction quality or actual runtime discovery.
- `npm run format:check` checks formatting. Use [build-and-test](../build-and-test/SKILL.md) for changed executable behavior and affected consumers.
- `npm run doctor` checks local environment prerequisites. Its network mode and `npm run timeweb -- check` are connection diagnostics, not skill-quality certificates or deployment requests.

For a changed activation or authority boundary, or to measure whether a skill improves the outcome, use [behavioral evaluation](references/behavioral-evaluation.md). Match each claim to the available evidence: structural validation, runtime discovery, observed activation or observed task behavior.

## Repair and report

When edits are authorized, repair the canonical source first and synchronize only affected pointers, UI metadata and maintained documentation. Keep activation automatic by default. Do not force unrelated skills into manual-only mode, change model settings or add mandatory audit loops to ordinary development.

Report confirmed defects before optional improvements. For each material finding give the source, trigger/consequence and smallest useful correction. Separate fixed items, remaining work, missing prerequisites and checks not run. List deferred product/data/hosting work separately from migration defects. Do not turn the audit into a new task registry or claim that a repository-only change reached production.
