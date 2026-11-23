---
name: ux-design
description: Design or assess user journeys, responsive layouts and interaction states for a selected application. Use for UX/UI specifications, prototypes and design handoffs. Follow the app's own visual language without requiring a design service.
---

# UX and interface design

Read the owning application's README, requirements and existing UI. Use the [designer role](../../roles/designer.md). Start with the affected user journey and current components rather than redesigning the whole application.

## Frame the user outcome

Identify the user, entry point, intent, decision, next action and observable completion. Preserve settled product choices. Distinguish the current workflow from a proposed capability. Clarify only missing choices that change the assigned experience.

Use representative real or clearly synthetic content: long labels, missing values, empty lists and error text. Preserve the app's tokens, components, typography and naming. Do not impose another application's branding, layout or stack. Verify factual copy and asset provenance, and mark unknown content instead of inventing product claims or reuse rights.

## Specify the changed experience

For a consequential layout or journey choice, compare credible alternatives using the same content and tasks. Explain differences in hierarchy, reading order, primary-action visibility and attention. A small change within an accepted layout needs a focused assessment, not a mandatory alternatives exercise. Separate aesthetic preference from demonstrated task performance.

Cover applicable default, loading, empty, validation, error, success and recovery states. For each transition, specify the initiating action, feedback, retained input and next available action. Use the [integration contract](../integration-design/SKILL.md) when completion depends on an external operation. Do not describe an unknown result as a confirmed failure or success.

For forms and dialogs, define labels, initial focus, keyboard order, dismissal/cancellation, focus return and error placement. Include async waiting, retry and unsaved changes where relevant. Account for responsive reading order, content wrapping, touch targets, contrast, enlarged text, screen-keyboard obstruction and reduced motion. Media controls and alternatives should match the content's role.

## Inspect and hand off

Inspect the rendered states that could invalidate the design, including a representative failure/recovery and applicable narrow/wide viewports. A desktop screenshot does not establish mobile behavior. Use [browser verification](../build-and-test/references/browser-smoke.md) when a preview is available. Mark unrendered or untested behavior explicitly.

Return an editable specification, assigned asset or prototype with source identity, layout/responsive rules, interaction states, copy/asset provenance, acceptance cases and unresolved choices. Existing app documentation is the owner of lasting decisions. A design service is optional. Do not add one solely for a handoff.

Application-code edits require assigned authorship. A design request does not authorize implementation or production publication. Check the environment actually requested: local, test or published. A local task must not silently become a deployment task. Give [QA](../quality-assurance/SKILL.md) observable acceptance cases rather than visual preference alone.
