---
phase: 2
title: 'Baseline on prod'
status: pending
priority: P1
effort: '0.5d'
dependencies: [1]
---

# Phase 02: Baseline on prod

## Goal

A recorded baseline report: calls/turn by kind and lane, billed tokens/turn, wasted
speculation, duplicate prompts, late corrections and turn latency. It comes from a
deterministic replay of real recordings through the prod API with Phase 01 deployed, run
3 times.

## Context to read first

- `plan.md` (user decisions, budget rules).
- `benchmarks/call-budget/README.md` (from Phase 01).
- `benchmarks/lid/replay_sessions.mjs`: how a turn is played over `/ws/translate` (100 ms frames at wall clock, token read from a file, never printed).
- `packages/realtime-client/src/audio/capture-pump.ts` and `packages/realtime-client/src/audio/capture-pump.replay.spec.ts`: how continuous audio is cut into turns the way the web client cuts it (`continuous`, `fullDuplex`, `maxUtteranceMs` 8000).
- `benchmarks/stt/scripts/streaming-arms/replay_committer.mts`: how a benchmark script imports shipped TypeScript with `npx tsx`.
- Recordings: `benchmarks/speaker-id/rulers/conversations/*.wav` with `*.turns.tsv` (owner's real conversations, gitignored data; never commit audio or transcripts).

## Files to Create / Modify

- Create: `benchmarks/call-budget/replay-recordings.mts`
- Modify: `benchmarks/call-budget/README.md`
- Modify: `.gitignore` (add `**/benchmarks/call-budget/results/`)
- Create (not committed): `benchmarks/call-budget/results/baseline/*`
- Create: `plans/reports/benchmark-<yymmdd-hhmm>-call-budget-baseline.md`

## Tasks

### Task 2.0 — User gate: deploy Phase 01 and approve the replay budget

- Goal: Phase 01 is live on prod, and the user has approved the replay's paid calls.
- Steps:
  1. Count the replay: sum the durations of the recordings you will use (all `*.wav` that have a `*.turns.tsv`). Estimate turns ≈ total speech seconds / 5, and calls ≈ turns × 5 × 3 runs.
  2. Tell the user, in one message: the PR link from Phase 01, the turn and call estimate, and that replay calls go through the **prod translation host (Command Code proxy)**, not DeepSeek direct, because a replay is a real client of the prod API. Ask the user to (a) merge the PR (merging deploys) and (b) approve the call estimate.
  3. Wait. Do not merge yourself.
- Success criteria: the user replied yes to both.
- Verify: after the deploy workflow finishes, `docker inspect -f '{{.Created}}' chatofy_prod_api` shows a time after the merge, AND, after one manual turn on prod (ask the user, or run Task 2.3 with one recording), `docker logs chatofy_prod_api --since 10m 2>&1 | grep -c "llm kind="` prints a number ≥ 1.

### Task 2.1 — Does the proxy report stream usage?

- **Done early, during Phase 01 (2026-11-02):** one probe call each, run inside `chatofy_prod_api`. Both printed `status 200 usage true cachedField true`, so `reportStreamUsage: true` is on for the Command Code proxy and for DeepSeek direct in the Phase 01 PR. Skip this task; record the result in the baseline report.
- Goal: know whether `reportStreamUsage` can be turned on for the Command Code host.
- Steps:
  1. Run ONE request (cost: 1 call) inside the API container so the key never leaves it:
     ```bash
     docker exec chatofy_prod_api node -e '
     const r = await fetch("https://api.commandcode.ai/provider/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+process.env.COMMAND_CODE_API_KEY},body:JSON.stringify({model:"deepseek/deepseek-v4-flash-fast",stream:true,stream_options:{include_usage:true},max_tokens:8,messages:[{role:"user",content:"Say hi"}]})});
     const t = await r.text(); console.log("status", r.status, "usage", /"usage"\s*:\s*\{/.test(t));' --input-type=module
     ```
     If the env var name differs, find it with `grep -n "commandCodeApiKey" apps/api/src/modules/translate/providers/*.ts apps/api/src/config/env.schema.ts` and use the env name it maps from. Do not print the key.
  2. Run the same probe once against DeepSeek direct (`https://api.deepseek.com/chat/completions`, model `deepseek-flash`, key `process.env.OPENAI_COMPATIBLE_API_KEY`, plus the host's `extraBody` from `register-default-providers.ts`). Cost: 1 call. A unit test cannot prove a host accepts the field.
  3. Record both results. Any host that printed `status 200 usage true` gets `reportStreamUsage: true`; one that did not must NOT have it (remove it from DeepSeek direct if its probe failed). Make that change in the Phase 03 PR, not as a separate merge, so it passes the Phase 04 Task 4.0 gate.
  4. If the proxy printed anything else, record in the report that proxy tokens are unknown on prod and are estimated from DeepSeek-direct benchmark runs.
- Verify: the printed line starts with `status ` and the decision is written in the Phase 02 report.

### Task 2.2 — The replay tool

- Goal: one command replays a list of recordings through the prod API exactly as the web client would, and prints the log window it used.
- Target: create `benchmarks/call-budget/replay-recordings.mts` (run with `cd apps/api && npx tsx ../../benchmarks/call-budget/replay-recordings.mts …`).
- Steps:
  1. Args: `--api <url>` (default `http://127.0.0.1:4000`), `--token-file <path>`, `--ids <id,id,…>` (default: every wav in the conversations dir that has a `.turns.tsv`), `--run-tag <name>`, `--pair vi-en`, `--mode two-way`, `--voice off`.
  2. Decode each wav to PCM, feed it through the shipped `CapturePump` with the web client's settings (`continuous`, `fullDuplex`, `maxUtteranceMs` 8000) at wall-clock pace, and send every turn it emits over one `/ws/translate` session per recording. Copy the socket, frame and end-of-turn handling from `benchmarks/lid/replay_sessions.mjs`; do not invent a new protocol flow.
  3. Per turn, append to `results/<run-tag>/rows.jsonl`: recording id, turn index, sent ms, ms to `server.transcript.final`, error code if any. Never write transcript text.
  4. On start and end print `window-start=<ISO>` and `window-end=<ISO>` (UTC). The analysis reads exactly that window.
  5. Read the token from `--token-file` and never print it or put it in argv.
- Success criteria: a dry run against one short recording ends with both window lines and `rows.jsonl` has one row per turn.
- Verify: `wc -l benchmarks/call-budget/results/<tag>/rows.jsonl` prints a number ≥ 1, AND `grep -c '"error":null' …/rows.jsonl` equals that number.

### Task 2.3 — Mint a 1-hour owner token

- Steps:
  1. Find the owner id read-only: `docker exec chatofy_prod_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT DISTINCT \"ownerId\" FROM \"Conversation\" WHERE \"clientId\" IN ('"'"'<id1>'"'"','"'"'<id2>'"'"')"'` using recording ids. Expect exactly one owner id.
  2. Sign a token inside `chatofy_prod_api` with the same claims the app signs (read `apps/api/src/modules/auth/adapters/jwt-auth.adapter.ts` ~L115 for the payload and options), `expiresIn: '1h'`, secret `process.env.AUTH_JWT_SECRET`. Write it to `$SCRATCHPAD/owner-token` with `chmod 600`. Never echo it.
  3. Also write the header line `Authorization: Bearer <token>` to `$SCRATCHPAD/owner-header` (chmod 600), so the token never appears in a command line (`ps` shows argv).
- Verify: `curl -s -o /dev/null -w '%{http_code}' -H @"$SCRATCHPAD/owner-header" http://127.0.0.1:4000/auth/me` prints `200`.

### Task 2.4 — Three baseline runs

- Steps:
  1. Run the replay 3 times with tags `baseline-1`, `baseline-2`, `baseline-3`, one after another (never in parallel: a second socket of the same user is the per-user cap at work, not load).
  2. For each, analyze its window:
     `docker logs chatofy_prod_api --since <window-start> --until <window-end> 2>&1 | node benchmarks/call-budget/analyze.mjs > benchmarks/call-budget/results/baseline-N/summary.md`
  3. If `--since` returns nothing, probe with `--tail N | head -1` at a few N to find the window (rotated json-file logs), then filter by timestamp.
- Success criteria: three summaries, each with turns ≥ 1 and calls/turn printed.
- Verify: `grep -h "calls/turn" benchmarks/call-budget/results/baseline-*/summary.md | wc -l` prints `3`, AND each summary's `starts=<n>` AND `turns=<n>` both equal `wc -l < results/<tag>/rows.jsonl` of that run (one start and one turn line per turn sent). More starts means organic traffic got in; `unended=` above 0 means a turn started and was disconnected without a turn line (grep `session.disconnect` for the id). Either way, discard the run and re-run.

### Task 2.5 — The baseline report

- Target: create `plans/reports/benchmark-<yymmdd-hhmm>-call-budget-baseline.md`.
- Content:
  - mean and min–max across the 3 runs for: turns, calls/turn, billed tokens/turn, p50/p95 `translated=`;
  - the per-kind/lane table (mean share %), marking every kind with share ≥ 20%;
  - wasted speculative calls, duplicate-prompt share of translate calls, `homophones` accepted per call, late corrections per call;
  - the proxy-usage decision from Task 2.1;
  - **Cut candidates**: the kinds with share ≥ 20%, plus any lever whose Phase 03 gate (see that file) is met by these numbers.
  - A final line `ultra-source: plans/reports/brainstorm-261102-0930-conversation-state-harness-and-call-budget.md`.
- Verify: the report file exists, and `grep -c "calls/turn" <report>` prints a number ≥ 1.

## Success criteria

- A baseline that later arms are compared to, from the same recordings and the same window method.

## Risks

- Organic traffic inside a window inflates counts → run when no one else uses prod; the `starts=` check in Task 2.4's Verify discards a contaminated run.
- Prod restarts mid-run empty the log → check `docker inspect -f '{{.Created}}'` before and after each run; if it changed, discard that run.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
