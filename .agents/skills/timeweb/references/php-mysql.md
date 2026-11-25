# PHP and MySQL delivery

The `npm run timeweb` publication helper accepts static artifacts only. A PHP/database application follows its own deployment procedure. Do not feed PHP into the static helper or make a speculative hosting change to reuse it.

Memo's concrete procedure is [deployment.md](../../../../apps/memo/deployment.md). Other apps own their own artifact layout, PHP extensions and data migrations. Do not impose Memo's routes or stack on them.

For a requested PHP deployment:

- Identify the existing target, web PHP version and required extensions, DB service and configuration location. SSH CLI PHP and site PHP can differ. Docker is local tooling, not a service to install on shared hosting.
- Verify the built frontend/API under its actual base path. Check deep-link refresh, resources, sessions and protected server/configuration files. Do not expose real credentials to establish whether access rules work.
- Review the exact file transfer and exclusions. Server secrets, uploads and other applications must survive it. Do not replace the shared document root with the monorepo or an unrelated app artifact.
- Before an authorized migration, establish backup, schema/app compatibility, locking or downtime needs, recovery and verification through [recovery](recovery.md). Use the selected database's actual tools and protected credential mechanism. Do not put passwords in command arguments or logs.
- Run only the app's intended migration in the configured environment. An additive schema creation script is not a universal upgrade/downgrade engine. Verify resulting data and a representative user operation, not only its exit status.

Prepare missing configuration and commands as far as the authorized task permits. A missing live DB or destination blocks that deployment step, not independent local checks. Report actual file/schema changes, tested behavior and unexercised recovery. Do not claim deployment from documentation or a local Docker test alone.
