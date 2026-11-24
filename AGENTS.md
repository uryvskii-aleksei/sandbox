# AGENTS.md — Sandbox

Personal monorepo: independent applications in `apps/`, shared code in `packages/`, deployment configuration in `infra/`. Repository: `uryvskii-aleksei/sandbox`. The default branch is `main`. Hosting is **Timeweb shared hosting**, accessed over SSH/SFTP. Read [README.md](README.md) for setup and [Timeweb](infra/timeweb/README.md) before deployment work.

## Instructions and runtimes

Keep one source per rule: common requirements here, procedures in `.agents/skills/`, role contracts in `.agents/roles/`. `.claude/`, `.cursor/` and `.codex/` contain adapters, not duplicate policies. `CLAUDE.md` imports this file. Preserve the user's model and runtime settings. Delegate only when the user or active runtime instructions authorize it. Roles do not themselves authorize delegation.

| Runtime     | Skills                     | Roles             | Formatting hook                                 |
| ----------- | -------------------------- | ----------------- | ----------------------------------------------- |
| Codex       | `.agents/skills/`          | `.codex/agents/`  | `.codex/hooks.json`, when supported and enabled |
| Claude Code | `.claude/skills/` pointers | `.claude/agents/` | `.claude/settings.json`                         |
| Cursor      | `.claude/skills/` pointers | `.cursor/agents/` | `.cursor/hooks.json`                            |

The format-touched hook uses the installed formatter owning the edited file. It never installs dependencies or formats another app's files. Explicit `npm run format:check` is the reliable formatting gate even when runtime hooks are unavailable.

## Scope and authority

- Deliver the requested outcome and continue authorized work through applicable checks. Resolve routine implementation choices from existing contracts. Ask only for missing decisions that change acceptance, architecture, external effects or authority. Continue independent work while waiting. Silence is not consent.
- An investigation or planning request does not start product implementation. A bare issue or PR link supplies context. Local implementation does not implicitly authorize commits, push, PR creation, merge, issue closure or production publication. An explicit delivery request including a PR includes its scoped commits, push and PR updates. A commit request alone excludes push. Reuse existing authorization without asking again at each stage.
- Re-read an external target immediately before a write, preserve manual changes, change only intended fields and verify the result. Do not send messages to other people without explicit authorization. Do not bypass repository or environment policies.
- Select an owned workspace before writing. Inspect root, branch, status and worktrees. Preserve unrelated changes. Never reset, stash, force-checkout or delete another task's work to obtain a clean tree. See [workspace ownership](.agents/skills/dev-cycle/references/task-worktree.md).
- Use the available GitHub connector or official MCP for repository, issue, PR and CI operations. `gh` is an optional CLI fallback. Discover actual tools instead of assuming names. Missing access blocks only dependent operations. Keep credentials in personal runtime settings, SSH configuration or GitHub secrets.
- Deployment requires the intended app, destination and published artifact to be concrete. Use only its configured target. Do not infer a domain, replace a site's document root, change DNS, delete remote files, buy resources or alter account-wide hosting settings as part of ordinary implementation.

## Monorepo boundaries

- Each app owns its runtime, source, tests, README, configuration and output directory. Do not impose React, Redux, TypeScript or a backend framework on unrelated apps. Document an app's additional conventions in its own `AGENTS.md` when needed.
- Shared packages must not depend on private application internals. Extract code only when there is an actual shared responsibility. Keep app-specific deployment files with the app. Static destinations use `infra/timeweb/targets.json`. PHP/database apps own their destination manifest and procedure, linked from `infra/timeweb/README.md`.
- Root npm workspaces cover direct `apps/*` and `packages/*` JavaScript packages. Other languages may use their own toolchain. Use the committed lockfile and real manifest scripts. Do not run multiple package managers over the same dependency graph.
- Add dependencies when the task needs them and explain material additions. Prefer existing capabilities and the smallest supported dependency. Preserve pins outside scope. Public package releases use SemVer. Website deployments are identified by commit and target, without mandatory version bumps for every edit.
- New branches use `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `chore/<slug>` or `docs/<slug>`. Omit an absent issue ID. Fetch the default branch before starting when access is available. Never overwrite a dirty checkout to update it. Continue an existing migration in its owned workspace when the task remains active.

## Development quality

- Make the smallest coherent change that fulfills the task. Preserve public contracts and unrelated edits. Reuse existing local components, clients, configuration and error handling. Avoid speculative frameworks or extension points.
- In TypeScript workspaces use strict types, `import type` and named exports. Avoid `any` and unchecked casts. Keep pure utilities free of input mutation. Preserve lifecycle, cancellation and state ownership when extracting code.
- Build accessible interfaces with semantic HTML, keyboard controls and required ARIA. Use the app's existing styling, icons and translations. Keep loading, empty and failure states explicit. Validate inputs at trust boundaries. Client validation is not a security boundary.
- Never commit tokens, SSH keys, `.env` files, connection dumps, production data or raw logs. Keep public build artifacts separate from backend configuration, uploads and secrets. Do not print credentials during diagnostics.
- Verify changed behavior and affected consumers with [build-and-test](.agents/skills/build-and-test/SKILL.md). Tests should cover meaningful behavior or failure boundaries, not mirror implementation or documentation wording. Do not weaken checks to make them pass.
- Use [quality-assurance](.agents/skills/quality-assurance/SKILL.md) for acceptance and exploratory behavior checks, [ux-design](.agents/skills/ux-design/SKILL.md) for interaction design and [integration-design](.agents/skills/integration-design/SKILL.md) for API/data contracts. Load only the procedure needed by the task.
- Match CI evidence to the actual commit. Report local checks, CI, independent review and deployment separately. Self-review is not independent review. Missing optional tools do not justify claiming a check passed.
- Keep temporary logs, browser output, review snapshots and research experiments outside the repository. Preserve source fixtures and approved snapshots. Ignore dependency and generated build directories.

## Documentation and language

- Russian: replies, human documentation, useful code comments/JSDoc, commit subjects, issue and PR prose. English: agent instructions, roles, skills and their references. Identifiers and logs follow the owning toolchain.
- Keep a concise README at the root and each application/package root, explaining purpose, setup, commands and publication where relevant. Number human documentation headings hierarchically: H2 `1.`, H3 `1.1.`. Do not duplicate contracts across READMEs.
- Lasting architecture decisions belong in `docs/designs/` or the owning app's documentation. A PR plan belongs in its `## План` section. A local task's plan and continuation state belong in chat. Do not create empty commits, issues, PRs or progress files solely to record a plan.
- Markdown filenames use lowercase kebab-case except conventional names such as `README.md`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md` and `CHANGELOG.md`. Follow the owning app's code naming conventions. Use full stops rather than semicolons in prose.
- Finish with the actual outcome, relevant evidence, skipped checks and concrete blockers. Do not assume remote changes or publication succeeded.
