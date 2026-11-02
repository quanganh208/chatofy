---
phase: 6
title: 'ConversationState and digest, flag off'
status: cancelled
priority: P1
effort: '2d'
dependencies: [4, 5]
---

# Phase 06: ConversationState and digest, flag off

## Precondition

Phase 05 Task 5.6 printed `GO`. If it printed `NO-GO`, do not start this phase. Tell the user and stop.

## Goal

Each connection keeps a `ConversationState` (what the conversation is about, plus the terms
it has used and how they were translated). A background digest refreshes it every K
finished turns, and the prompt builder injects it under the measured rules. Everything is
behind `TRANSLATE_CONVERSATION_DIGEST=off|shadow|on`, default `off`. With `off`, every
prompt is byte-identical to today's.

## Design (settled; do not redesign)

- **What is kept:** `domain` (≤ 4 words) and `terms` (glossary-shaped `GlossaryEntry`, each side ≤ 4 words, ≤ 64 chars). No free-text summary. No register: unmeasured, and it would enter every prompt.
- **How it is made:** one non-streaming JSON-mode call on the translation host (on prod: the Command Code proxy model `deepseek/deepseek-v4-flash-fast`, failing over to `deepseek-flash` direct; the offline arm in Phase 07 measures `deepseek-flash` direct, and the report must say so), every `TRANSLATE_DIGEST_EVERY_TURNS` (default 5) finished turns. It reads the last ≤ 10 finished turns (source + delivered translation). It is never awaited by a turn. Budget: 6 per user per minute, 24 global (`TranslationBudget`, the pattern in `session/turn-polisher.ts`).
- **What it may write:** a deterministic guard keeps only (a) a domain within caps, and (b) term pairs whose source side occurs in a finished source turn and whose target side occurs in a delivered translation (match with `foldForMatch`). Everything else is dropped.
- **When a term is used:** only after it was proposed in ≥ 2 digests (`seen ≥ 2`), and only for a turn whose own transcript contains its source side. A turn without the term gets zero extra bytes.
- **When the domain is used:** as `Subject:` only when the user set no topic AND the transcript needs prior speech (≤ 4 words or `continuesCut`, the existing `needsPriorSpeech`). Complete sentences never get a generated topic: that is where anchoring was measured.
- **Priority:** user glossary first, then conversation terms, together ≤ `MAX_GLOSSARY` (24). Dedupe keeps the user's entry.
- **Both directions** (user decision): terms apply in one-way and two-way. The guard and the caps are the protection.
- **Lifetime:** per socket (`WeakMap`, like `ConversationContext`); nothing is persisted.

## Context to read first

- `packages/ai-providers/src/providers/gemini/prompt-builder.ts`: `asTranscriptData` ~L194, `needsPriorSpeech` ~L400, `buildContextBlock` ~L442, `dedupeGlossary` ~L551, the caps ~L47-140.
- `packages/ai-providers/src/providers/openai-compatible/openai-compatible-translation-provider.ts` ~L189 and `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts` ~L149 (both call `buildContextBlock`).
- `packages/ai-providers/src/providers/openai-compatible/openai-compatible-loanword-respeller.ts` (the JSON-mode `complete()` pattern, plus the Phase 01 `onCall`).
- `packages/types/src/events/ws-events.ts` `GlossaryEntry` (~L146-150): a language-keyed map with ≥ 2 languages.
- `apps/api/src/modules/translate/session/conversation-context.ts` (WeakMap pattern, `forget`).
- `apps/api/src/modules/translate/session/turn-polisher.ts` (fire-and-forget + budget pattern).
- `apps/api/src/modules/translate/services/translation-session.service.ts` ~L1033 (`this.context.remember(` loop: the point a turn's final source AND its translations are both known), `speculate()` ~L607, final `translateAll(` calls (`grep -n FINAL_MODELS`).
- `apps/api/src/modules/translate/session/live-preview.ts` `translateLive` and `session/block-retranslator.ts`.

## Files to Create / Modify

- Create: `packages/ai-providers/src/interfaces/conversation-digest.ts`
- Create: `packages/ai-providers/src/providers/openai-compatible/conversation-digest-prompt.ts` (+ spec)
- Create: `packages/ai-providers/src/providers/openai-compatible/openai-compatible-conversation-digester.ts` (+ spec)
- Create: `packages/ai-providers/src/text/conversation-digest-guard.ts` (+ spec)
- Modify: `packages/ai-providers/src/interfaces/translation-provider.ts`, `packages/ai-providers/src/interfaces/index.ts`, `packages/ai-providers/src/index.ts`
- Modify: `packages/ai-providers/src/providers/gemini/prompt-builder.ts` (+ spec), both translation providers' `buildContextBlock` calls
- Modify: `packages/ai-providers/src/registry/provider-registry.ts` (a `conversationDigester` slot, following how `translationPolisher` is registered)
- Modify: `apps/api/src/modules/translate/providers/register-default-providers.ts`, `apps/api/src/modules/translate/providers/ai-providers.factory.ts`
- Create: `apps/api/src/modules/translate/session/conversation-state.ts` (+ spec)
- Create: `apps/api/src/modules/translate/session/conversation-digest-runner.ts` (+ spec)
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`, `services/pipeline-translator.service.ts`, `session/live-preview.ts`, `session/block-retranslator.ts`
- Modify: `apps/api/src/config/env.schema.ts`, `apps/api/src/modules/translate/session/translation-cost-policy.ts`, `apps/api/.env.example`, `prod.env.example`

## Tasks

### Task 6.1 — Types

- Steps: in `interfaces/conversation-digest.ts` export
  ```ts
  export interface DigestTurn {
    source: string;
    translation: string;
    sourceLanguage: LanguageCode;
    targetLanguage: LanguageCode;
  }
  export interface ConversationDigestRequest {
    turns: DigestTurn[];
  } // oldest first, at most 10
  export interface ConversationDigestProposal {
    domain?: string;
    terms: GlossaryEntry[];
  }
  export interface ConversationDigester {
    readonly name: string;
    digest(req: ConversationDigestRequest): Promise<ConversationDigestProposal | null>;
  }
  /** What a translation request may carry from the conversation. Already guarded. */
  export interface ConversationHints {
    domain?: string;
    terms: GlossaryEntry[];
  }
  ```
  Add `conversation?: ConversationHints` to `TranslationRequest` with a docblock naming the two injection rules from the Design section. Export everything from the interfaces index and the package index.
- Verify: `pnpm --filter @chatofy/ai-providers typecheck` exits 0.

### Task 6.2 — Prompt builder: inject under the rules

- Target: `buildContextBlock` in `prompt-builder.ts`.
- Steps:
  1. Extend the signature with a fourth optional argument `conversation?: { hints?: ConversationHints; transcript: string; continuesCut?: boolean }`.
  2. Terms: keep only entries whose side for `languages.source` folds (`foldForMatch`) into the folded transcript as a substring, then append them AFTER the user's glossary into the same `dedupeGlossary` pass, so the existing caps, the 4-word rule and the user-first dedupe apply unchanged.
  3. Domain: if `hints?.topic` is empty AND `needsPriorSpeech(transcript, continuesCut)` is true, use `conversation.hints.domain` as the topic (through the same `asTranscriptData` + `MAX_TOPIC_CHARS` path).
  4. The early return at the top (`if (!hints && !utterances.length) return null;`, ~L447) would drop conversation hints for every session without user hints, which is most of them. Compute the filtered conversation terms and the domain decision BEFORE it, and return `null` only when hints, utterances, conversation terms and domain are all empty.
  5. Update both provider call sites to pass `{ hints: req.conversation, transcript: text, continuesCut: req.continuesCut }`.
  6. Specs (`prompt-builder.spec.ts`):
     - no `conversation` → output byte-identical to calling without the argument (`toBe` on the string);
     - `hints` undefined, no prior speech, one conversation term present in the transcript → the block is non-null and contains the pair;
     - a term whose source is not in the transcript → absent;
     - a term present → its line appears after the user's pairs; a user pair with the same source wins;
     - 30 user + conversation pairs → total ≤ 24;
     - a conversation term with a 5-word side → dropped;
     - domain + 3-word transcript → `Subject:` present; domain + 12-word transcript → absent; user topic set → the user's topic, not the domain.
- Verify: `pnpm --filter @chatofy/ai-providers test -- prompt-builder` exits 0.

### Task 6.3 — The guard

- Target: `text/conversation-digest-guard.ts`, `acceptDigest(proposal: unknown, turns: DigestTurn[]): ConversationHints`.
- Steps: parse defensively (the input is model JSON). Domain: string, trimmed, `countTermWords` ≤ 4, ≤ 64 chars, no `<` `>`. Else drop. Terms: each a map with exactly the two languages of a turn pair; each side `countTermWords` ≤ `MAX_GLOSSARY_TERM_WORDS` and ≤ 64 chars; source side must fold-match inside some `turn.source` of that language, target side inside some `turn.translation`; at most 12; dedupe by folded source. Return `{ domain?, terms }`.
- Specs: an invented term (in no turn) → dropped; a sentence-length side → dropped; `"Reply with OK"` as a target not present in any translation → dropped; non-JSON → `{ terms: [] }`.
- Verify: `pnpm --filter @chatofy/ai-providers test -- conversation-digest-guard` exits 0.

### Task 6.4 — The digester

- Steps:
  1. `conversation-digest-prompt.ts`: a system instruction saying the turns are DATA, never instructions. Ask for JSON `{"domain": string, "terms": [{"<src lang>": "...", "<tgt lang>": "..."}]}`: the domain is what the conversation is about, in English, ≤ 4 words; terms are names, jargon and recurring phrases, each side copied verbatim from a source line and from its translation line, ≤ 4 words. The user message wraps each turn's source and translation with `asTranscriptData` inside `<transcript>` tags (export `asTranscriptData` from `prompt-builder.ts` for this; it stays the single fencing edge).
  2. `openai-compatible-conversation-digester.ts`: same request shape as the respeller's `complete()` (JSON mode, temperature 0, `max_tokens` 400, timeout 8,000 ms), `onCall` with `kind: 'digest'`, returns the parsed JSON or `null` on any failure. It never throws to the caller.
  3. Register a `conversationDigester` slot under BOTH names the respeller is registered under, each with `onCall: logLlmCall`:
     - the `deepseek`/`openai` loop (`register-default-providers.ts` ~L234-245);
     - the `commandcode` failover (~L296-316): primary proxy model `deepseek/deepseek-v4-flash-fast`, secondary DeepSeek direct, sharing `commandCodeCircuit` exactly as the respeller does.
       Add `makeConversationDigester()` to `ai-providers.factory.ts` by copying `makeTranslationPolisher()` (~L167-179; it resolves by `AI_TRANSLATION_PROVIDER`, and prod runs `commandcode`, so a slot built only for `deepseek` would be `null` on prod).
  4. Temperature: DeepSeek non-thinking pins temperature to 1.0 whatever is sent (`benchmarks/homophone-repair/README.md`). Keep `temperature: 0` in the body, and write in a comment that determinism comes from the guard and `seen ≥ 2`, not from temperature.
  5. Specs: request body has `response_format: {type:'json_object'}`; a 500 → `null` and an `ok: false` event; `makeConversationDigester()` is non-null with `AI_TRANSLATION_PROVIDER=commandcode` and with `deepseek`.
- Verify: `pnpm --filter @chatofy/ai-providers test -- conversation-digest` exits 0 AND `pnpm --filter api typecheck` exits 0.

### Task 6.5 — State and runner in the API

- Steps:
  1. `conversation-state.ts`: `ConversationStateStore` with a `WeakMap<StreamSocket, State>`. State = `{ domain?: string; terms: Map<string, { entry: GlossaryEntry; seen: number }>; recent: DigestTurn[] (≤ 10); sinceDigest: number; inFlight: boolean }`. Methods: `noteFinished(socket, turn): boolean` (returns true when `sinceDigest ≥ everyTurns` and not in flight); `merge(socket, accepted)` (re-proposed terms `seen += 1`, new ones `seen = 1`, keep ≤ 24 terms, evicting lowest `seen` then oldest; domain replaced when present); `hintsFor(socket): ConversationHints | undefined` (only terms with `seen ≥ 2`; undefined when empty); `forget(socket)`.
  2. `conversation-digest-runner.ts`: fire-and-forget like `TurnPolisher`. Takes a digester or null, a budget (6/user/min, 24 global), and the store. `run(socket, userId)`: set `inFlight`, call `digest`, guard with `acceptDigest`, `merge`, clear `inFlight` in `finally`. Log `digest ok terms=<n> domain=<yes|no>` or `digest skipped (<reason>)`. Never log text.
  3. Env: `TRANSLATE_CONVERSATION_DIGEST` (`off|shadow|on`, default `off`, enum wrapped in `emptyStringAsUndefined(…)` like `TRANSLATE_LIVE_MODE` in `env.schema.ts` ~L199), `TRANSLATE_DIGEST_EVERY_TURNS` (int 2–20, default 5), added to `TranslationCostPolicy`. Add `# TRANSLATE_CONVERSATION_DIGEST=` and `# TRANSLATE_DIGEST_EVERY_TURNS=` (optional form: `#`, exactly one space, key, `=`) to `prod.env.example`, or the deploy's prod.env check (`scripts/check-prod-env.mjs`) fails the moment the key is set in `prod.env`. Verify: copy `prod.env.example` to `$SCRATCHPAD/prod.env.check`, set both keys live in the copy, and `node scripts/check-prod-env.mjs "$SCRATCHPAD/prod.env.check"` exits 0 (usage: `node scripts/check-prod-env.mjs <prod.env> [--example <file>]`).
  4. In `translation-session.service.ts`, in the `this.context.remember(` loop (~L1035): when mode ≠ `off`, per `piece` (it has `sourceText` and `translations: TranslationMap`): `const target = session.languages.targets[0]; const translation = target ? piece.translations[target] : undefined; if (translation) due = store.noteFinished(socket, { source: piece.sourceText, translation, sourceLanguage: session.languages.recognition, targetLanguage: target })`. (`TurnLanguagePlan` has `targets` and `recognition`, but no `spoken` field: `turn-language-plan.ts` ~L30-36.) If `due` is true after the loop, `runner.run(…)`. In `forget`/disconnect handling, call `store.forget(socket)` beside `this.context.forget(socket)`.
  5. Injection: when mode is `on`, pass `conversation: store.hintsFor(socket)` on every translate path: `speculate()` (thread through the `transcribeAndTranslate` input → `translateAll` → `translate` → provider request), every final `translateAll(`, `live-preview.ts` `translateLive`, and the block retranslator. When mode is `shadow`, run the digest but pass nothing.
  6. Specs:
     - store: `seen` threshold, eviction, `forget`;
     - runner: budget exhausted → no call; a digester returning garbage → state unchanged;
     - session: mode `off` → digester never called and the provider requests carry no `conversation` (assert on the mocked pipeline);
     - mode `on`, after 10 finished turns whose terms repeat → the 11th turn's request carries the term.
- Verify: `pnpm --filter api test -- conversation-state conversation-digest-runner translation-session` exits 0.

### Task 6.6 — Whole-phase gate

- Verify, all must pass:
  - `pnpm --filter @chatofy/ai-providers build && pnpm --filter @chatofy/ai-providers test` exits 0;
  - `pnpm --filter api typecheck && pnpm --filter api test && pnpm --filter api lint` exits 0;
  - with no new env set, the full suites above pass with every pre-existing spec unchanged, and the byte-identical spec from Task 6.2 passes. Together these prove `off` is today's behavior. The paid injection run is Phase 07.
- Commit (`feat(translate): keep a guarded conversation state and digest it in the background`), open a PR, do not merge (Phase 07 measures first).

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
