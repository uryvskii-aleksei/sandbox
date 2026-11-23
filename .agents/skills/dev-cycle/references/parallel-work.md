# Roles and delegation

Delegate only when authorized by the user or active runtime instructions. Available role definitions do not grant that authority. Small cohesive work may be completed directly. Independent review is useful for changed behavior, deployment boundaries or substantial design choices, but report it as pending if it cannot run.

The coordinator owns integration, Git/index mutations, external services and the final report. Planner and reviewer are read-only. Coder edits only assigned paths and never mutates Git, calls external services or delegates further. Preserve the user's model and runtime permissions.

An assignment includes the absolute workspace and branch, expected outcome, owned files, relevant requirements and decisions, dependencies and acceptance checks. Shared files have one author at a time. Independent assignments may run concurrently only within the runtime limit. Reconcile ownership before making fixes to another author's files.

For code review, save the relevant base-to-HEAD diff, dirty diff, status and untracked content outside the repository. Include exact source commits, requirements and completed checks. Use `diff` for a bounded change, `full` for the integrated task, or `artifact` for a research/design snapshot. The reviewer checks source, callers and evidence and returns actionable findings with locations and scenarios. A capability probe or refusal is not a completed review.

Role restrictions are behavioral unless enforced by the runtime. Do not claim a role file creates a separate sandbox or removes inherited tools. Workers return concise results, changed paths, checks and unresolved concerns. The coordinator validates the integrated tree and distinguishes self-review from independent review.
