# Behavioral skill evaluation

Use [existing scenarios](../../../../docs/designs/agent-harness.md#6-сценарии-оценки) when they fit. Before running a case, record the expected decision and the evidence that would establish it. For activation or authority changes, choose a matching request, a close nonmatching request and a relevant scope transition, such as research to implementation or verification to publication.

## Observe automatic activation

Run each request in a fresh session in the target runtime with the usual skill catalog for that workspace. Use natural wording without naming the skill or telling the agent to load it. Check runtime events or tool traces for the skill actually loaded. Catalog discovery, a relevant answer and an agent's claim to have loaded a skill are insufficient evidence. If the trace cannot show whether the skill loaded, mark activation as unverified.

When tuning the description from examples, keep some realistic requests aside to check the final wording. Repeat cases with inconsistent results and report the variation.

## Compare task outcomes

Run the same request with the revised skill and with its previous version. For a new skill, use a baseline without the skill. Use separate fresh sessions with the same runtime, model, tools, permissions and equivalent starting data. Record the exact skill revision and evaluate both runs against the same criteria. Compare observable decisions, tool effects and deliverables. Distinguish a deliberately loaded skill in this comparison from automatic activation.

Run only the permitted cases and tools. Keep temporary fixtures and evaluation traces outside the repository. If execution or a comparable baseline is unavailable, report what was observed and label any author walkthrough as such. A written scenario or a passed structural check does not establish how an agent behaves.
