# Browser verification

Start the owning app using its documented command and an unused port. Open the changed flow and exercise relevant actions, keyboard behavior, loading and failures. Inspect console and network evidence. Use available browser tools rather than assuming one MCP server name or existing tab.

Before interacting, inspect the rendered page and wait for a condition that shows the flow is ready, such as a named action becoming enabled or expected content appearing. Identify controls by role and accessible name when available. Network silence alone does not establish readiness.

For an app under a domain subdirectory, verify asset URLs, router refresh/deep links and API/callback paths. For a subdomain, check the intended origin and cross-origin behavior. Static export must be tested as the built artifact when publishing to shared hosting.

Use existing interaction/screenshot checks or Storybook when configured. Story existence alone does not prove the scenario ran. Do not introduce Storybook just for a smoke check.

Correlate observed failures with expected behavior. Redact credentials and personal data from console/HAR evidence. Do not persist raw logs unless requested. Stop only servers started for this check. Report the exercised flow and checks that could not run.
