# CI evidence

Read PR source/base identity and required checks. Match each Actions run and job to the actual current commit or PR merge commit. Inspect failed/pending jobs and bounded useful logs. A green run on a previous commit is not current evidence.

Report local checks separately from Actions, human review, policy satisfaction and hosting publication. A build only proves the checks it executed. Do not claim all applications were tested by the harness workflow.

Create an authorized PR before waiting for PR-triggered CI. Follow the requested run to completion when asked. Otherwise take a bounded status snapshot and link unfinished checks. Re-read source identity before reporting. Do not rerun, cancel or edit workflows without authority for that operation.
