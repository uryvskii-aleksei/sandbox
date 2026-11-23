---
name: timeweb
description: Check SSH access, plan or publish a selected application's static artifact to Timeweb shared hosting. Use for Timeweb hosting work, not Timeweb Cloud resources or automatic production deployment after ordinary coding.
---

# Timeweb shared hosting

This repository uses ordinary virtual/shared hosting, not Timeweb Cloud. Use SSH/SFTP and the existing personal SSH identity. Do not add a Cloud token, provision a VPS or assume a persistent backend process is supported. Read [the maintained setup and target contract](../../../infra/timeweb/README.md).

1. Read the requested app and current `infra/timeweb/targets.json`. Identify its real domain/path, SSH alias, remote document root and local artifact directory. Missing values block only a live connection or publication. Do not populate invented targets.
2. Verify access with `npm run timeweb -- check <target>`. Before an app exists, `npm run timeweb -- check` checks the account in `infra/timeweb/connection.json` without publishing or creating an app target. These checks read the directory's availability. An existing template is not proof of successful access.
3. Run the owning app's checks and build. Ensure it supports the hosting runtime. The helper supports **static artifacts only**. A server-side app needs its own reviewed deployment procedure. For a domain subpath, verify router base, assets and deep links.
4. Preview the exact transfer with `npm run timeweb -- plan <target>`. Inspect the changed files, source commit, destination and recovery plan. The helper does not delete stale files or create remote directories. It updates files in place and is not an atomic release system.
5. When publication to this target is already authorized, use `npm run timeweb -- publish <target> --apply`. Do not add another approval stop for the same scope. Without publication authority, finish the concrete preview and ask only for the missing authority. Never run publication as a test.
6. Verify the public URL over HTTPS, assets and a relevant user flow. Record actual commit, target, result and any remaining old files. A successful rsync alone is not a successful website check.

Keys and known-host data live outside Git. Verify the server fingerprint through a trusted channel. Keep host checking enabled. Do not publish a full workspace, `.env`, source-control data or dependency directories. Do not overwrite uploads, change DNS, delete directories or perform database migrations as part of this static helper. Establish a specific recovery method before a live overwrite.

For GitHub Actions, use per-application environment secrets and the verified known-host entry from the setup guide. Add an actual deployment workflow only when its app, build and target exist. Keep PR checks free of deployment credentials.
