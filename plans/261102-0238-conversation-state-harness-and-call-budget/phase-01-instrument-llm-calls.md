---
phase: 1
title: 'Instrument every cloud LLM call'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 01: Instrument every cloud LLM call

## Goal

Every cloud LLM call on the translation host writes exactly one structured `llm …` log line
(kind, purpose, model, latency, tokens, prompt hash), and a script turns a log window into a
calls-per-turn and tokens-per-turn table. **No behavior change.**

## Why

Today the cost cannot be measured. The provider never reads `usage`, polish success is not
logged, and `translate(…)` lines do not say whether a call was a live preview, a speculation
or a final. Every later phase is gated on these numbers.

## Context to read first

- `packages/ai-providers/src/providers/openai-compatible/openai-compatible-translation-provider.ts` (streaming loop ~L258-351, `StreamChunk` ~L142).
- `packages/ai-providers/src/providers/openai-compatible/openai-compatible-loanword-respeller.ts` (`complete()` ~L157; callers at ~L118 respell, ~L130, ~L146).
- `packages/ai-providers/src/providers/openai-compatible/openai-compatible-translation-polisher.ts` (`polish()` ~L70).
- `apps/api/src/modules/translate/providers/register-default-providers.ts` (all `new OpenAiCompatible*(` sites: ~L216, 238, 280, 286, 303, 309, 326).
- `packages/ai-providers/src/interfaces/translation-provider.ts` (`TranslationRequest`).
- `apps/api/src/modules/translate/services/pipeline-translator.service.ts` (`settleCorrections` ~L305, `translate` ~L935, `translateAll` ~L1033, `transcribeAndTranslate` ~L1082).

## Files to Create / Modify

- Create: `packages/ai-providers/src/interfaces/llm-call-event.ts`
- Modify: `packages/ai-providers/src/interfaces/index.ts` (export it), `packages/ai-providers/src/index.ts` if interfaces are re-exported there
- Modify: `packages/ai-providers/src/interfaces/translation-provider.ts`
- Modify: the three openai-compatible provider files above and their `*.spec.ts`
- Create: `apps/api/src/modules/translate/providers/llm-call-log.ts`
- Modify: `apps/api/src/modules/translate/providers/register-default-providers.ts`
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts`, `apps/api/src/modules/translate/services/translation-session.service.ts`, `apps/api/src/modules/translate/session/live-preview.ts`, `apps/api/src/modules/translate/session/block-retranslator.ts`
- Create: `benchmarks/call-budget/analyze.mjs`, `benchmarks/call-budget/analyze.test.mjs`, `benchmarks/call-budget/README.md`

## Tasks

### Task 1.0 — Branch and toolchain

- Goal: work happens on a feature branch with pnpm available.
- Steps:
  1. `git switch main && git pull && git switch -c quanganh208/feat/conversation-state-call-budget`
  2. Put Node v26 on PATH (shell default is v24 without pnpm): `export PATH=$HOME/.nvm/versions/node/v26.12.1/bin:$PATH`. Prefix every later `pnpm` and `git commit` command with it; never bypass the husky hook with `--no-verify`.
- Success criteria: `pnpm -v` prints a version.
- Verify: `node -v` starts with `v26` AND `pnpm -v` exits 0.

### Task 1.1 — The event type

- Goal: one type every provider emits.
- Target: create `packages/ai-providers/src/interfaces/llm-call-event.ts`.
- Steps:
  1. Export:
     ```ts
     export type LlmCallKind =
       'translate' | 'polish' | 'respell' | 'fusion' | 'homophones' | 'digest';
     export type LlmCallPurpose = 'live' | 'speculation' | 'final' | 'retry' | 'block';
     export interface LlmCallEvent {
       kind: LlmCallKind;
       purpose?: LlmCallPurpose;
       host: string; // the provider's `name`
       model: string;
       ms: number;
       ok: boolean;
       inputTokens?: number;
       outputTokens?: number;
       cachedInputTokens?: number;
       /** First 8 hex chars of sha256 over JSON.stringify({ model, messages }). Never the text itself. */
       promptHash: string;
     }
     export type LlmCallListener = (event: LlmCallEvent) => void;
     ```
  2. Add a docblock explaining: the hash exists to count byte-identical prompts (dedupe opportunity) without logging transcript text.
  3. Export the three types from `packages/ai-providers/src/interfaces/index.ts` (follow how `translation-polisher` is exported there).
- Success criteria: types importable as `import type { LlmCallEvent } from '@chatofy/ai-providers'`.
- Verify: `pnpm --filter @chatofy/ai-providers typecheck` exits 0.

### Task 1.2 — `purpose` on the translation request

- Target: `packages/ai-providers/src/interfaces/translation-provider.ts`, interface `TranslationRequest`.
- Steps: add `purpose?: LlmCallPurpose;` with a docblock: "Which lane asked. Logged only; a provider must not change behavior on it."
- Verify: no verification needed (Task 1.3 typechecks it).

### Task 1.3 — Emit from the streaming translation provider

- Target: `openai-compatible-translation-provider.ts`.
- Steps:
  1. Add to `OpenAiCompatibleTranslationConfig`: `onCall?: LlmCallListener;` and `reportStreamUsage?: boolean;` (docblock: sends `stream_options: { include_usage: true }`; only for hosts known to accept it).
  2. In the request body built ~L275, when `reportStreamUsage` is true, add `stream_options: { include_usage: true }` AFTER the `...this.extraBody` spread (same ordering rule as `stream: true`).
  3. Extend `StreamChunk` with `usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;`.
  4. In the `for await` loop (~L324-335), when a parsed event has `usage`, keep it. Cached tokens = `prompt_cache_hit_tokens ?? prompt_tokens_details?.cached_tokens`.
  5. `generate()` (~L266) does not receive `req`. Emit from `translate()`'s ladder loop (~L211-214), around each `generate(...)` attempt (one per model tried): success or throw, call `this.onCall?.({ kind: 'translate', purpose: req.purpose, host: this.name, model, ms, ok, inputTokens, outputTokens, cachedInputTokens, promptHash })`. Have `generate()` return the parsed usage beside the text so the loop can read it. Compute `promptHash` with `createHash('sha256')` from `node:crypto` over `JSON.stringify({ model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: user }] })`, i.e. exactly the two messages `generate()` sends, sliced to 8 hex chars.
  6. A throwing listener must never fail the call: wrap the call to `onCall` in `try { … } catch { /* metrics never fail a turn */ }`.
- Tests (same spec file, existing fetch-mock pattern):
  - streamed body whose last chunk carries `usage: { prompt_tokens: 120, completion_tokens: 30, prompt_cache_hit_tokens: 64 }` → listener receives `inputTokens 120, outputTokens 30, cachedInputTokens 64, ok true, kind 'translate'`;
  - `reportStreamUsage: true` → the posted body contains `"stream_options":{"include_usage":true}`; default → it does not;
  - HTTP 500 → listener receives `ok: false` and the call still rejects as before;
  - a listener that throws does not change the returned text.
- Verify: `pnpm --filter @chatofy/ai-providers test -- openai-compatible-translation-provider` exits 0 and the output contains the new test names as passed.

### Task 1.4 — Emit from the respeller and the polisher

- Targets: `openai-compatible-loanword-respeller.ts` (`complete()`), `openai-compatible-translation-polisher.ts` (`polish()`).
- Steps:
  1. Add `onCall?: LlmCallListener` to each config interface.
  2. Non-streaming responses carry `usage` in the JSON body; read `prompt_tokens`, `completion_tokens`, and cached tokens as in Task 1.3.
  3. Respeller `kind`: the existing `what` strings are `'respelling'`, `'homophone repair'` and `'recognizer fusion'` (~L122, 134, 150). Do not map by text: add an explicit `kind: LlmCallKind` parameter to `complete()` and pass `'respell'`, `'homophones'` and `'fusion'` from the three callers.
  4. Polisher `kind: 'polish'`.
  5. Emit on success and on failure, guarded by `try/catch` like Task 1.3.
- Tests: one spec per file — success with usage → event with tokens; HTTP error → `ok: false`.
- Verify: `pnpm --filter @chatofy/ai-providers test` exits 0.

### Task 1.5 — The API-side log line

- Target: create `apps/api/src/modules/translate/providers/llm-call-log.ts`.
- Steps:
  1. Export `logLlmCall(event: LlmCallEvent): void` using a module-level `new Logger('LlmCall')`.
  2. Exact format, one line, no transcript text:
     `llm kind=<kind> purpose=<purpose|-> host=<host> model=<model> ms=<ms> ok=<1|0> in=<n|-> out=<n|-> cached=<n|-> h=<promptHash>`
  3. Unit spec `llm-call-log.spec.ts`: spy on `Logger.prototype.log`, assert the exact string for one event with all fields and one with tokens missing (`in=- out=- cached=-`).
- Verify: `pnpm --filter api test -- llm-call-log` exits 0.

### Task 1.6 — Wire the listener at every construction site

- Target: `register-default-providers.ts`.
- Steps:
  1. Pass `onCall: logLlmCall` to every `new OpenAiCompatibleTranslationProvider(`, `new OpenAiCompatibleLoanwordRespeller(`, `new OpenAiCompatibleTranslationPolisher(` (sites ~L216, 238, 280, 286, 303, 309, 326).
  2. Pass `reportStreamUsage: true` ONLY for the DeepSeek host (the host object named `deepseek`, base URL `https://api.deepseek.com`). Leave the Command Code proxy (`deepseek/deepseek-v4-flash-fast`) without it until Phase 02 Task 2.1 proves the proxy accepts it.
  3. Do not touch the summarization provider (minutes are not per turn).
- Verify: `grep -c "onCall: logLlmCall" apps/api/src/modules/translate/providers/register-default-providers.ts` prints `7`, AND `pnpm --filter api typecheck` exits 0.

### Task 1.7 — Pass `purpose` from every caller

- Targets and values:
  - `session/live-preview.ts` `translateLive` → `.translate({ …, purpose: 'live' })`.
  - `services/pipeline-translator.service.ts`: add `purpose?: LlmCallPurpose` to the `translate` and `translateAll` request types and forward it into `trio.translation.translate({ … })`; add `purpose?` to the `transcribeAndTranslate` input type and forward it into its `translateAll` call (~L1186); `retryAdopted` passes `purpose: 'retry'`.
  - `services/translation-session.service.ts` `speculate()` (~L607) passes `purpose: 'speculation'` in the `transcribeAndTranslate` input; every final `translateAll(` call with `models: FINAL_MODELS` (e.g. ~L1490) passes `purpose: 'final'`. Find them with `grep -n "FINAL_MODELS" apps/api/src/modules/translate/services/translation-session.service.ts`.
  - `session/block-retranslator.ts` translation call → `purpose: 'block'`.
- Success criteria: no translate call site is left without a purpose.
- Amended during execution (kongming counsel): the REST `translateTurn` passes `purpose: 'final'`, and the meeting chat (`apps/api/src/modules/conference/services/conference-chat.service.ts`) passes a new lane `'chat'`, so typed messages never count as `final` turns. The two exact-shape assertions in `pipeline-translator.service.spec.ts` now include `purpose: 'final'`.
- Verify: `pnpm --filter api typecheck` exits 0 AND `pnpm --filter api test -- translate` exits 0.

### Task 1.8 — Count corrections that arrive too late to be shown

- Target: `settleCorrections` in `pipeline-translator.service.ts` (~L305) and its two callers (`pipeline-translator.service.ts` ~L1197, `translation-session.service.ts` ~L1504).
- Steps:
  1. Add an optional second parameter `onLate?: () => void`, called once when the grace timer wins the race.
  2. Both callers pass `() => this.logger.log('correction late, dropped')`.
  3. Spec: a `correcting` promise resolving after `CORRECTION_GRACE_MS + 50` → returns `undefined` and calls `onLate` once (use fake timers as the existing specs of this function do; if none exist, add `vi.useFakeTimers()`).
- Verify: `pnpm --filter api test -- pipeline-translator` exits 0.

### Task 1.9 — The analysis script

- Target: create `benchmarks/call-budget/analyze.mjs` (standalone, not in the workspace, same convention as `benchmarks/error-analysis`).
- Steps:
  1. Input: a log text on stdin (the output of `docker logs chatofy_prod_api --since … --until … 2>&1`). Strip ANSI codes first (`/\x1b\[[0-9;]*m/g`).
  2. Count server turns: lines matching `/TurnMetricsRecorder\]\s+turn \S+ (ok|FAILED)/` that do NOT contain `client outcome=`. Print `starts=<n>` = distinct ids on `TranslationSessionService] session.start <id>` lines in the window. On this path one `session.start` is logged per TURN (the same id appears on that turn's `turn <id> ok` line), so a replay window must show exactly as many starts as turns the replay sent; more means organic traffic got in. `llm` lines carry no session id.
  3. Parse every `llm kind=…` line into fields.
  4. Print Markdown to stdout, nothing written to disk:
     - turns; total calls; calls/turn;
     - a table by `kind/purpose`: calls, share %, calls/turn, sum in, sum out, sum cached, failed count;
     - billed tokens/turn = (sum in + sum out) / turns, and a line saying how many calls had no token counts;
     - duplicates: calls whose `h=` already appeared in the window, as count and share of `translate` calls;
     - `correction late, dropped` count; `homophones … accepted=N` sum of N and call count (from the existing `homophones(` lines);
     - p50 and p95 of `translated=<n>ms` from the turn lines;
     - speculation: hit/miss counts and wasted speculative calls (speculations on miss turns) from `speculation=hit|miss/K`.
  5. `analyze.test.mjs` with `node:test`: a fixture string of 3 turn lines, 6 `llm` lines (one duplicate hash), 1 late correction → asserts turns=3, calls/turn=2.00, duplicates=1.
  6. `README.md`: what it reads, the exact docker command (always with `--since`/`--until`), and that nothing under `results/` is committed.
- Verify: `node --test benchmarks/call-budget/analyze.test.mjs` exits 0.

### Task 1.10 — Whole-phase gate

- Verify, all must pass:
  - `pnpm --filter @chatofy/ai-providers build` exits 0;
  - `pnpm --filter @chatofy/ai-providers test` exits 0;
  - `pnpm --filter api typecheck` exits 0;
  - `pnpm --filter api test` exits 0;
  - `pnpm --filter api lint` exits 0 with no new errors;
  - `git diff --stat main` lists no file outside the "Files to Create / Modify" list above.
- Then commit (conventional, e.g. `feat(api): log every cloud LLM call with tokens and lane`) and open a PR. Do NOT merge: merging to `main` deploys to prod (`.github/workflows/deploy.yml`). Merge only after the user says so (Phase 02 Task 2.0).

## Success criteria

- The 7 provider construction sites emit; every translate caller names its lane.
- The analysis script reproduces the hand-counted numbers on the fixture.
- Zero change in prompts, models, timing or events sent to clients.

## Risks

- A host rejects `stream_options` → that is why it is opt-in per host (Task 1.6).
- Log volume: one extra line per call (~5 per turn). Acceptable; same sink as today.

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
