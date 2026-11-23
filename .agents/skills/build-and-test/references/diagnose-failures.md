# Diagnose a failure

Use this procedure when a test, build, application or environment behaves unexpectedly. Scale investigation to the uncertainty and consequence. A reproducible obvious cause does not need a ceremonial multi-stage report.

1. Capture the exact failure, command/trigger, source identity, runtime and starting data. Read the first relevant error and trace before treating later failures as independent defects. Preserve redacted diagnostics outside Git.
2. Reproduce at the smallest useful boundary. Compare recent code, dependency and configuration changes with a working example. Distinguish environment/access failures from application failures. Separate access, configuration and readiness problems rather than classifying every failed connection as a service outage.
3. Trace the affected values across caller, transport, service and persistence as needed. Inspect whether a timeout left the operation unexecuted or committed with a lost response. Do not log secrets or whole customer payloads. Do not replay production writes as a diagnostic shortcut.
4. State one falsifiable hypothesis and the smallest safe check that separates it from alternatives. Avoid stacking unrelated fixes. If evidence contradicts it, revise the hypothesis. Repeated unsuccessful changes call for reassessing assumptions, not an arbitrary retry counter or automatic architecture rewrite.
5. Correct the demonstrated cause and verify the original failure. Add a useful regression test where it protects behavior. A one-off environment issue or prose fix does not require an implementation-mirroring test. Check affected neighboring behavior and stop once meaningful evidence is sufficient.

Prefer waiting for an observable readiness condition with a deadline over fixed sleeps. A retry policy needs a finite stopping point and a repeatability contract. Use [integration-design](../../integration-design/SKILL.md) when the failure crosses effect boundaries.

For an external or intermittent cause that cannot be reproduced locally, state what evidence is available, what remains unknown and what bounded handling or observation is justified. Do not invent a root cause or mark dependent scenarios passed. Continue independent checks.
