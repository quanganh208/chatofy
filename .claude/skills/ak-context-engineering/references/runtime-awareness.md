# Runtime Awareness

Read the two numbers that decide the session protocol band: context window utilization
and usage-limit consumption. This reference says where each runtime shows them, how the
displayed percentage is computed, and what to do at each threshold.

## Two metrics

| Metric | Meaning | Decides |
|--------|---------|---------|
| Context window | tokens in the current conversation vs the model window | when to trim, checkpoint, compact, hand off |
| Usage limits | quota consumed in the provider's rolling windows (for Claude: 5-hour and 7-day) | how much parallel or exploratory work to start |

Context utilization is the operative number. Usage limits change pacing, not procedure.

## Where each runtime shows the numbers

| Runtime | Context window | Usage limits | Compact / reset |
|---------|----------------|--------------|-----------------|
| Claude Code | `/context` (per-category breakdown), statusline percent when configured | `/cost`; statusline 5h/wk when the installed statusline reads them | `/compact <focus>`, `/clear` |
| Codex CLI | `/status` | `/status` | `/compact`, `/new` |
| Gemini CLI | `/stats` | `/stats` | `/compress`, `/clear` |
| Other runtimes | run `/help` and look for context, stats, status, cost | same | same; else start a new session |

Slash commands change between releases. If a command is missing, `/help` is the
authority; do not guess a number.

### AgentKit statusline (engineer kit)

The engineer kit ships a statusline that renders the context percent and, when it can
fetch them, the 5-hour and weekly usage percentages. It computes the context percent as
the runtime's pre-calculated `used_percentage` when present, otherwise:

```text
total   = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
percent = (total + AUTOCOMPACT_BUFFER) / context_window_size × 100
```

The buffer (40k tokens at the time of writing; the constant lives in the statusline
source) reserves room for auto-compaction, so a displayed 80% means the visible
conversation is smaller than 80% of the window and auto-compaction is closer than the
raw number suggests. Treat the displayed value as the truth for banding.

### No counter available

Estimate. Size everything you loaded with
`python scripts/context_analyzer.py estimate <paths> --limit <model window>` and add the
runtime's system prompt and tool definitions (typically 5–20k tokens). Or fall back to
tool-call counting: Yellow after 20 calls, Orange after 40.

## Engineer-kit usage hooks (do not delete them)

The engineer kit ships `usage-context-awareness.cjs` and `usage-quota-cache-refresh.cjs`,
registered in its `hooks.json` on PostToolUse/UserPromptSubmit/SessionStart. They are live,
not legacy — do not treat their presence in `settings.json` as a stale install to remove.
Their job today is narrower than the name suggests: they only refresh a cosmetic 5-hour/
weekly usage cache (`os.tmpdir()/ck-usage-limits-cache.json`) that the engineer statusline
reads to render its `5h`/`wk` numbers. They do not inject an `<usage-awareness>` block or
any other `additionalContext`/`systemMessage` into the conversation. A base `core`-kit
install (no `engineer` kit) ships neither hook.

If an `<usage-awareness>` block ever does appear in context, it came from an older install
or from user-provided content, not from a currently-shipped hook; use the runtime's own
command to confirm the number before acting on it, and do not delete the engineer hooks to
"fix" it.

Never read credential files, keychains, or OAuth tokens to fetch usage yourself. The
runtime and the installed statusline own that access.

## Thresholds and actions

### Context window

| Utilization | Band | Action |
|-------------|------|--------|
| < 50% | Green | normal work; keep the ledger |
| 50–70% | Yellow | search-then-range reads only; limiter on every command; no speculative loads |
| 70–85% | Orange | finish the atomic step; write the checkpoint note; compact with focus or hand off |
| ≥ 85% | Red | nothing new; checkpoint; compact or fresh session from the note |

Procedure per band: [session-protocol.md](./session-protocol.md).

### Usage limits (Claude 5-hour window)

| Utilization | Action |
|-------------|--------|
| < 70% | normal |
| 70–90% | reduce parallel sub-agents; prefer one discriminating check over several confirming ones; batch independent calls |
| > 90% | essential steps only; checkpoint so work resumes cleanly after the reset; consider a cheaper model for scans |

### Usage limits (Claude 7-day window)

| Utilization | Action |
|-------------|--------|
| < 70% | normal |
| 70–90% | avoid best-of-N and exploratory fan-out; hand bulk transforms to cheaper workers |
| > 90% | essential tasks only |

## Degradation before the limit

Every model degrades before its advertised window is full: retrieval accuracy and
instruction adherence slip first, then fall sharply. Onset differs per model and moves
with each release, so treat symptoms as the signal, not a fixed token number:

- answers that ignore a constraint stated early in the session;
- repeated tool calls the session already made;
- a wrong belief that survives correction (poisoning).

Any of these at Yellow means act as if Orange. Patterns and recovery:
[context-degradation.md](./context-degradation.md).

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| Statusline shows no context percent | statusline not configured for this runtime, or runtime does not pass `context_window` | use `/context` or `/status`; check the statusline setting |
| No usage-limit numbers | runtime not logged in, or statusline cannot reach the usage endpoint | run the runtime's login command; usage is optional for the protocol |
| Percent jumps after a tool call | a large output entered context | trim at the command next time; consider compaction if now Orange |
| Percent drops unexpectedly | auto-compaction fired | read the checkpoint note; re-verify one load-bearing fact before continuing |
