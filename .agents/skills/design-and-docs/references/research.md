# Research and technical decisions

State the concrete question, mandatory constraints, useful evidence and stopping condition. Read existing code and official documentation before requesting information already available. Use temporary prototypes outside the repository when an experiment will settle the question.

Compare real alternatives only when there is a meaningful choice. Evaluate them against the same constraints, including hosting compatibility, recovery and operational cost when applicable. Do not invent an alternative to satisfy a template. Missing access is an incomplete check, not proof that an approach fails.

Record the answer, authoritative links or reproducible checks, limits, recommendation and next action. Lasting repository decisions belong in `docs/designs/<slug>.md` or the owning app's documentation. Research issue content may link that design when external writing is authorized. Preserve explicit human decisions separately from agent recommendations.

A useful design covers the goal, user scenarios, boundaries, changed contracts, important failure/recovery paths and reasons for material choices. Include implementation details only when they explain a decision. Check methods and hosting assumptions against actual sources. Link evidence instead of copying long transcripts.

If the assignment includes decomposition, identify independently useful implementation outcomes with dependencies and acceptance checks. Do not create GitHub issues without authority. An investigation request ends with the findings and next step. If implementation was already included, return to it without a routine approval stop.
