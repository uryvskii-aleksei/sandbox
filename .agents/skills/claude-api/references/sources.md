# Source and current SDK references

This skill is adapted from [anthropics/skills — claude-api](https://github.com/anthropics/skills/tree/main/skills/claude-api), retrieved on 2026-11-23 under Apache-2.0. The original license is retained in `../LICENSE.txt`.

The adapted entrypoint narrows activation to Claude application integrations, removes a fixed premium model and automatic thinking defaults, routes by the owning monorepo app and accounts for PHP shared hosting. The original skill's unrelated language guides and managed-agent workflows are not installed.

Consult only the documentation relevant to the task:

- [Claude API overview](https://platform.claude.com/docs/en/api/overview).
- [Official TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).
- [Official PHP SDK](https://github.com/anthropics/anthropic-sdk-php).
- [Current models](https://platform.claude.com/docs/en/about-claude/models/overview).
- [Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).
- [API errors](https://platform.claude.com/docs/en/api/errors).

These are live sources. Check the installed SDK version before adopting examples from its latest branch. Do not preload every link for a small integration change.
