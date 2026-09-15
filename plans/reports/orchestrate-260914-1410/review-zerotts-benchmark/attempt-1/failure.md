# attempt 1 — FAILED (provider routing)

Exit 1 after 14s, 12,131 tokens consumed, no result.md produced.

Provider error, repeated twice then abort:

    OpenAI Responses bad request: The requested item was created under a
    different *** OpenAI resource. Use the same resource that created the item
    to access it. [trace_id=47638f378abac5786debb6c9fea54004]

Diagnosis: AgentRouter (wire_api = "responses") load-balances across backend
OpenAI resources. Codex's second request referenced a conversation item created
on the first backend; the follow-up landed on a different one, which cannot
resolve that item id. Not caused by the prompt, the sandbox, or the repo.
