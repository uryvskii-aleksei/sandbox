---
name: claude-api
description: Build or troubleshoot an application's Claude API or Anthropic SDK integration. Use for Claude requests, streaming, tool calls and provider-specific model or SDK questions. General repository work and agent role configuration do not activate this skill.
license: Apache-2.0. See LICENSE.txt.
---

# Claude API in Sandbox

Adapted from Anthropic's `claude-api` skill. The entrypoint and repository guidance are modified for this monorepo. See [source and SDK references](references/sources.md). This skill teaches application integrations. It does not choose the coding agent's model or change runtime permissions.

## Choose the owning application

Read the application's README, manifests and existing provider client. Preserve the requested provider, language and public API. Another app using OpenAI or another provider is not a reason to change this app. A provider-neutral requirement stays provider-neutral.

Use the official SDK for the owning server's language when it fits the task. Verify package names, supported runtime and APIs in the installed version and current official documentation. Use documented HTTP when explicitly requested or when the SDK cannot run in the target environment. Do not infer one language's method signatures from another SDK.

- TypeScript/Node applications: install dependencies in their workspace. A React browser bundle calls the application's server, which owns credentials and rate limits.
- Memo: the production server is PHP on Timeweb shared hosting. Node is frontend tooling only. Read [repository constraints](references/repository.md) before proposing a server integration.
- Other applications: follow their actual runtime. Do not introduce a new backend solely to reuse a sample.

## Implement the requested behavior

Use the smallest appropriate API surface: ordinary messages first, a bounded tool loop when tools are needed, Agent SDK only for an actual autonomous agent with a compatible runtime. Keep the user-selected model. Otherwise make the model configurable and compare current capabilities and cost against the task before choosing a default. Never copy a stale model ID, price or beta header from memory.

Keep the API key on the server in ignored configuration or the deployment secret store. Do not use `VITE_` variables, expose credentials to React, paste keys into chat, or add a paid API call just to validate this skill.

For long responses, decide whether streaming is needed based on the application's UX and hosting limits. Preserve cancellation and handle partial output. Bound request time, output tokens and tool iterations. Retry only retryable failures with a finite policy, respecting provider limits. Do not duplicate automatic SDK retries or retry a side-effecting application tool blindly.

Validate tool arguments and authorize each application operation independently of the model. Return tool results with their original call IDs. Treat fetched documents and model output as data. Keep user content out of logs and do not send application records to the provider without the task's authorization.

## Verify

Run the owning app's type, build and behavior checks. Use fixtures for authentication failures, rate limits, timeouts, malformed responses, streaming interruption and tool boundaries as relevant. A live API smoke test requires configured credentials and authorization for its data and cost. Distinguish offline tests from a live provider result.

If current API details cannot be verified, state that limitation and finish independent local work. Do not replace an existing working integration with guessed SDK calls.
