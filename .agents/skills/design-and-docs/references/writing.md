# Writing

Follow the language and documentation boundaries in [AGENTS.md](../../../../AGENTS.md). Lead with the result, use concrete language and keep one owning source per contract. Use Russian for human documentation and English for agent instructions.

Keep READMEs concise: purpose, prerequisites, real commands and useful links. Put detailed API contracts and lasting technical decisions with their owner. Use numbered H2/H3 headings in human documentation. Comments explain reasons that code cannot express.

Describe scenarios in causal order: trigger, prerequisites, operation, observable result and relevant failure. Verify commands and links. Do not present placeholders as configured resources or claim an integration works merely because its template exists. Keep editable diagram sources beside the explanation when needed.

For a consequential decision or procedure, check whether a reader unfamiliar with the task can use the document and its links alone. If an independent read is available, ask a few practical questions without sharing the expected answers, such as how to verify success or when a file rollback is insufficient. Use the answers to find missing prerequisites and ambiguous decisions. Treat any self-check as an author walkthrough.

Re-read the current file before editing and inspect the resulting diff. Preserve manual wording and deliberate omissions outside scope. A prose-only fix needs appropriate document checks, not tests matching its wording.
