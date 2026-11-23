# Rollout and recovery on shared hosting

Read the owning app's deployment procedure and inspect the real target. This reference supports an authorized deployment or recovery task. It does not initiate one.

## Identify the release

Record the exact source/build, artifact directory, target path and runtime/configuration shape. Compare local/test/hosted versions and intentional differences, including schema, identities, data, external endpoints and scheduled jobs. Test configuration must not reach production through a forgotten callback or credential.

The configured static helper updates files in place, does not delete stale files and is not atomic. Identify affected behavior, readiness signals and a realistic observation/stop condition. A transfer exit code or HTTP 200 alone does not prove application success. Check cache headers and the owning app's asset versioning when stale resources could hide a release; do not impose a global query-string convention.

## Preserve recoverable state

Before an authorized overwrite or schema change, identify a usable previous artifact and backup of the affected app's data, uploads and required configuration. Keep backups and secrets outside `public_html` and Git. Scope the backup to the selected app/database. Do not infer backup scope or retention from a panel label.

A completed backup command does not prove restoration. When restore verification is in scope, use an isolated permitted destination with outbound mail, webhooks and jobs contained. Verify relationships, attachments and an important application operation after restore. State the observed coverage and recovery time/data gap if measured. Do not invent tolerated downtime or loss.

## Choose a compatible recovery

Check whether the previous application can read data written by the new one. File rollback, database restoration and reconciliation with external systems are separate operations. An irreversible migration can require a forward correction or a coordinated restore rather than uploading older files.

Define the point to stop, who can execute the recovery and what observation establishes improvement. A prepared procedure is not an exercised restore. Do not test recovery by restoring live production or deleting newer data without authority for that operation.

## Investigate incidents

Start with affected behavior and time window. Compare recent artifact, configuration and dependency changes. Separate observations from hypotheses. Choose a small reversible mitigation with a way to assess it, using [failure diagnosis](../../build-and-test/references/diagnose-failures.md). Do not reset an account, change DNS or replay writes merely to see whether the problem disappears.
