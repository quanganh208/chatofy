# attempt 2 — FAILED (config rejected, 0s)

Tried to dodge attempt 1's cross-resource item error by forcing the older wire
protocol: `-c model_providers.agentrouter.wire_api='"chat"'`.

Codex 0.154.0 refuses it:

    Error loading config.toml: `wire_api = "chat"` is no longer supported.
    How to fix: set `wire_api = "responses"` in your provider config.
    https://github.com/openai/codex/discussions/7782

So `responses` is the only wire API this Codex version speaks, and the
cross-resource failure mode cannot be avoided by protocol choice.
`disable_response_storage` was also probed and is not a recognized config key in
this version (rejected under `--strict-config`).

Follow-up probe: a two-turn tool-calling task succeeded on BOTH `gpt-6-astra`
and `gpt-5.6-sol`, which establishes attempt 1 as transient backend
load-balancing rather than a deterministic provider incompatibility. Retried
unchanged as attempt 3.
