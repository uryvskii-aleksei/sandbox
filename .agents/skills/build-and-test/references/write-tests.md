# Behavior tests

Test observable contracts and meaningful failure boundaries. Choose the owning app's existing runner. For Node tooling prefer the built-in test runner when it covers the need without dependencies.

Exercise the real unit boundary and mock external systems, time or network only where isolation requires it. Cover the trigger, result and a relevant regression. For file or deployment tooling, use temporary directories and fake executables. Never test by publishing to a real hosting account.

Do not assert incidental wording, private implementation steps or file inventories as substitutes for behavior. Reversible prose/formatting edits do not require new tests. Avoid fixed sleeps, ambient credentials and tests that depend on another running app.

Check error, cancellation, retry or cleanup behavior when the changed path has those responsibilities. Run the regression and affected tests. Explain untested integration boundaries instead of overstating mock coverage.
