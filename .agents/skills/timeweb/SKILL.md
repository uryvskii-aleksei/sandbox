---
name: timeweb
description: Check SSH access and prepare or publish a selected application to Timeweb shared hosting, including artifact checks and recovery planning. Use the static helper only for static artifacts and the owning procedure for PHP/MySQL. Ordinary coding does not start deployment.
---

# Timeweb shared hosting

This repository uses ordinary virtual/shared hosting, not Timeweb Cloud. Use SSH/SFTP and the existing personal SSH identity. Read [the maintained setup and target contract](../../../infra/timeweb/README.md). Do not provision a VPS, add a Cloud token or assume a persistent backend process is available.

## Establish the destination and release

Read the owning app's README, deployment procedure and task authority. Identify its actual URL/base path, SSH alias, remote directory, source/build identity and local artifact. Check runtime, configuration and schema differences rather than assuming a local container equals the hosted environment. Missing live values block only the dependent connection or publication.

`infra/timeweb/targets.json` is the static helper's destination registry. `npm run timeweb -- check` checks the account read-only through `connection.json`, and `check <target>` checks a registered static destination. These commands do not publish or create an app target. Do not infer a target from another application's directory.

Select the procedure by the artifact:

- **Static:** use the configured helper below.
- **PHP/MySQL:** read [PHP/database delivery](references/php-mysql.md) and the owning app's actual procedure. The static helper does not perform PHP delivery or database migrations.

For rollout, data changes, restore or incident work, read [recovery](references/recovery.md). Establish a recovery method proportional to the affected files and data before a live overwrite. A document describing backup or rollback is not evidence it was exercised.

## Publish a static target

1. Run the owning app's checks and build. Verify base URL, resources and deep links for the selected destination. Ensure the artifact excludes private data and server configuration.
2. Use `npm run timeweb -- check <target>` and `npm run timeweb -- plan <target>`. Inspect the exact changed files, artifact identity, destination and recovery plan. The helper performs a dry run, updates in place, does not delete stale files or create directories, and is not atomic.
3. When publication to that target is already authorized, use `npm run timeweb -- publish <target> --apply`. Reuse that authority instead of requesting approval at every routine stage. Without it, finish the concrete plan and ask only for the missing authority. Never publish as a test.
4. Verify the actual HTTPS URL, assets, cache behavior, deep-link refresh and relevant user outcome. A successful rsync or HTTP 200 alone does not establish application behavior. Report source/build, target, file changes, observed checks and unexercised recovery.

Keys and known-host data stay outside Git. Verify the fingerprint through a trusted channel and keep host checking enabled. Do not publish a full workspace, `.env`, source-control data, backups or development dependencies. Preserve other apps, uploads and server secrets. DNS changes, destructive cleanup and live restores are separate scoped operations.

For GitHub Actions, use the owning app's environment secrets and verified host entry. Add a deployment workflow only for a concrete app, artifact and destination. Keep PR checks free of deployment credentials.
