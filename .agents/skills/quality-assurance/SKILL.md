---
name: quality-assurance
description: Plan and execute acceptance, exploratory and regression checks against an identified application build. Use for user-flow verification, QA plans and defect retesting. Code review and build commands have separate owners.
---

# Application quality assurance

Use the owning app's README and acceptance criteria. The [qa role](../../roles/qa.md) defines responsibility. [build-and-test](../build-and-test/SKILL.md) owns executable checks. This skill can also guide the author’s checks without claiming independence or requiring a separate worker.

## Establish the expectation

Identify the user outcome, approved scope, exact source/build, dirty or new files, environment, affected integrations and allowed effects. Derive expected behavior from requirements and contracts before comparing it with the implementation. An unresolved requirement is a decision gap, not permission to accept current behavior.

Distinguish a capability from a value hypothesis: a working feature does not by itself prove adoption, conversion or saved time. Keep current accepted behavior separate from a proposed future workflow. State the boundary being accepted, such as local preparation, server persistence or downstream completion.

## Choose cases by consequence

Prioritize access boundaries, irreversible loss, incorrect records and a blocked primary task. Use the smallest set of positive, negative and recovery cases that can expose distinct failures. Relevant examples include empty/unavailable data, duplicate actions, cancellation, stale versions, refresh and restoring interrupted work. A small visual fix does not require an application-wide audit.

Each useful case states its requirement, starting data/state, action, observable expected result and recovery where relevant. Verify persisted behavior when persistence is promised. Do not derive expected values from the code being tested or treat a success toast as proof of completion.

Use separate synthetic data and the app's actual test environment. Execute permitted local checks or author assigned tests. Production writes and external submissions are coordinator actions within their authorized scope. A browser or API check that changes records is a write.

## Observe and report

Trace UI feedback, request, service response, stored state and downstream consumption only as far as the claimed outcome requires. Mocks establish the exercised local contract, not live provider compatibility. For changed UI, select representative viewport and keyboard scenarios through [browser verification](../build-and-test/references/browser-smoke.md).

At the first unexpected transition, preserve reproduction conditions and separate it from dependent symptoms. Continue independent cases when one prerequisite is unavailable. Use these result categories:

- **Passed:** the identified build met an established expectation at the tested boundary.
- **Failed:** an observed mismatch. Give expected/actual behavior, trigger, impact and reproduction.
- **Blocked:** a concrete missing prerequisite prevented execution.
- **Not run:** execution was not attempted. Explain material coverage gaps.

Recheck the original failure after a correction and affected neighboring behavior. Preserve still-valid evidence rather than rerunning unrelated suites. Report test-data cleanup, exact build/environment, cases, defects and remaining uncertainty. Same-author testing is not independent QA. Readiness advice does not authorize publication, and [reviewer](../../roles/reviewer.md) owns code/design analysis.
