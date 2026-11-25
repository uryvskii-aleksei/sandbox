---
name: build-and-test
description: Build, lint and test affected applications or agent tooling, diagnose failures and verify behavior in a browser or CI. Use for verification or regression coverage, using the owning application's actual commands.
---

# Build and test

Read the owning README, manifest and CI configuration. Do not assume a language, test runner, Storybook or universal build command. Root `npm run check` covers the harness, imported site tests, React types and formatting. Memo PHP/MySQL integration checks run separately through `npm run test:memo` with Docker. For a JavaScript workspace use its actual script, for example `npm run build --workspace=apps/<name>`.

Select checks for the changed boundary: formatting/lint, types, meaningful regression tests, build, affected consumers and browser scenarios as needed. Reuse still-valid evidence. Do not repeat unrelated suites after success without a new reason.

| Work                                          | Reference                                            |
| --------------------------------------------- | ---------------------------------------------------- |
| Write or assess tests                         | [Behavior tests](references/write-tests.md)          |
| UI smoke checks and console/network diagnosis | [Browser checks](references/browser-smoke.md)        |
| Diagnose a failure or uncertain environment   | [Failure diagnosis](references/diagnose-failures.md) |
| Match PR status to actual CI runs             | [CI evidence](references/ci-evidence.md)             |

For acceptance, exploratory checks or a QA plan, use [quality-assurance](../quality-assurance/SKILL.md) to establish expected behavior. It complements executable checks rather than requiring a second worker for every task.

Diagnose the first relevant failure before changing unrelated code. Compare source, environment and actual inputs. Use the failure reference when the cause is uncertain.

Fix causes without weakening rules, deleting meaningful coverage or adding blanket suppressions. Distinguish environment/access failures from code failures. Do not install dependencies in an unrelated workspace to make a command run.

Report exact commands and results, source identity, skipped checks and implications. Build success does not establish browser behavior, CI success or deployment. Keep run artifacts outside the checkout except ignored tool output needed by existing scripts.
