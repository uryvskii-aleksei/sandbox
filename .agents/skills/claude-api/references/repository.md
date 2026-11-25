# Repository constraints

Sandbox applications have independent stacks. Read `AGENTS.md` and the owning app's README before edits.

Memo uses React/Vite, PHP and MySQL. Locally, PHP and MySQL run in Docker Compose while Vite runs on macOS. Timeweb shared hosting runs PHP requests and serves the built frontend. It does not host a persistent Node Agent SDK process.

A Claude feature here belongs behind the authenticated PHP API. The feature must check ownership, apply CSRF protection to writes, set a finite request timeout and account for the hosting request duration. Persist a conversation only when the product needs it. A background job requires a concrete hosting mechanism such as a configured cron job, not a new unbounded process.

If Composer is needed, build server dependencies in a compatible environment and include the required production vendor files in the selected app artifact. Never upload the monorepo, local `.env`, Docker files or agent instructions to the webroot. The current app does not include a Claude feature, SDK dependency or API key by installing this skill.
