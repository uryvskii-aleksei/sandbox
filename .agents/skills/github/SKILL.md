---
name: github
description: Work with sandbox GitHub Issues, branches, pull requests and Actions using a connected integration or gh. Use for repository delivery, PR review or CI investigation.
---

# GitHub

Repository: `uryvskii-aleksei/sandbox`, default branch `main`. Read [connection setup](../../../docs/github.md) when access is missing. Prefer the connected official plugin/MCP, with `gh` as an available fallback. Discover actual tool capabilities and verify the account and target repository. Never request tokens in chat or assume public Git reads prove write access.

## Issues and context

Read the requested issue, relevant linked decisions and existing work. Preserve human descriptions, labels and unrelated state. Create or change only scoped issues when authorized. Use real dependencies instead of imposing a corporate hierarchy or status process. A bare link does not start implementation.

## Branch and PR delivery

Use an [owned workspace](../dev-cycle/references/task-worktree.md) and the delivery endpoint in [Scope and authority](../../../AGENTS.md#scope-and-authority). Commit only the verified changes owned by the current task. Use `Closes #…` only when closure on merge is authorized.

Before a write, re-read the current branch/HEAD or remote object. Push the exact intended source ref. Create or update one matching PR, preserve human content and verify the resulting source commit and changed files. If the base repository is empty, a PR needs an existing base commit. Do not invent empty history solely to open one.

When the endpoint is `main`, follow [PR checks](../build-and-test/references/ci-evidence.md) to a result. Fix failures caused by the task within its scope. If required checks, reviews or branch protection block merge and you cannot resolve the blocker, leave the PR open and report the condition. Before merging, verify the current PR head, base, diff and CI evidence. Use GitHub's merge operation with the expected head SHA where supported, then verify that the reported merge commit is in remote `main`.

Write Russian PR prose around the problem, resulting behavior and actual checks. Use the repository template as a starting point, remove unused placeholders and keep a substantial implementation plan in `## План`. Mark an item complete only after its changes are actually in the PR. A local task needs no empty draft PR.

Use structured body arguments. With `gh`, write multiline text to a temporary file and use `--body-file` to preserve newlines and avoid shell substitution. After editing a remote description, read it back.

## Review and Actions

Read review scope and the current diff. Support findings with a concrete trigger, effect and source location. Do not submit comments, review decisions or replies without authorization for that external write.

Match required checks to the current source under [CI evidence](../build-and-test/references/ci-evidence.md). Inspect the relevant failed job, not an unbounded log dump. Respect branch protection and workflow permissions. Report CI, human review, merge and deployment as distinct outcomes. Never claim success from an old run.
