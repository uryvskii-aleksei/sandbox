# Workspace ownership

One coordinator owns one branch and workspace. Inspect the absolute root, branch, HEAD if present, status and `git worktree list --porcelain` before writing. An unborn repository has no HEAD. Preserve all unrelated staged, unstaged, untracked and needed ignored data.

Continue an existing task in its owned workspace. For a new task, fetch `origin` when available and use the current default branch, normally `origin/main`. Use another base when requested. Report unknown freshness if access is unavailable. A free clean primary checkout may be updated with `git pull --ff-only` before branching. Never force an update.

If the primary checkout is occupied by another task, create a uniquely named linked worktree under `.worktrees/` or the runtime's managed location. Check the destination is unused and the branch is not checked out elsewhere. Do not create a worktree for every small change. Use the selected absolute root in all commands and assignments.

Immediately before staging, committing, changing branches or pushing, re-read root, branch and status. Fail on an identity mismatch rather than switching back automatically. Stop a command sequence after a failed Git command. Push the intended HEAD to the explicit source branch and read it back before claiming delivery.

Do not create coordination chats or send cross-chat messages without authority from the user or active runtime. Use an isolated workspace when ownership is uncertain. A role or repository procedure does not override runtime restrictions.

Worktree removal is separate work. Remove only a requested, clean, inactive workspace after verifying that its commits and necessary local data are preserved. Never force removal, delete a shared branch or infer cleanup permission from PR creation. Do not switch another task's primary checkout after delivery.
