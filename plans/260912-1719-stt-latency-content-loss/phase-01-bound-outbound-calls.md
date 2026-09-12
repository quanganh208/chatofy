---
phase: 1
title: 'Phase 1: Bound every outbound call, cap the speculation fan-out'
status: completed
priority: P1
effort: '4-6h'
dependencies: []
---

# Phase 1: Bound every outbound call, cap the speculation fan-out

## Overview

Give every dependency call on the speech path a deadline, and stop one turn from
spending four full-turn decodes plus four metered Gemini requests. This is the fix for
the reported single-user symptom: today a slow Gemini turn (max measured **8943ms**) holds
its slot until `MAX_IN_FLIGHT = 3` fills, the server refuses `too_many_turns`, and the
client throws away the whole pending buffer after 4 × 750ms of retries.

## Requirements

Functional:

- Every `fetch` to the local speech sidecars carries an `AbortSignal` deadline, and an
  expired deadline surfaces as the existing `ProviderConnectionError`.
- The Gemini client is constructed with an HTTP timeout.
- ~~At most one speculation is in flight per turn; a second is refused until the first settles.~~
  **Attempted and reverted — the tests proved it a regression.** Blocking renewal while a guess
  is unsettled suppresses the _useful_ guess: guess 1 is already stale when more audio arrives,
  so it is unreclaimable waste either way, while guess 2 is the only one the endpoint can reuse.
  The turn-session and translation-session specs failed exactly there (renewal suppressed, the
  measured 870ms head start lost — spec: "renews the guess at a later pause"). Reverted per this
  phase's own pre-decided response: keep the timeouts, revert this step alone. Verification source:
  `turn-session.spec.ts` + `translation-session.service.spec.ts` (877 pass with the revert).

Non-functional:

- Budgets must sit far above measured worst cases so a timeout never cuts a slow-but-working
  call: STT warm is 70–200ms, TTS p95 1125ms/clause, Gemini max 8943ms.
- No change to the `SttProvider` / `TtsProvider` / translation-provider interface shapes;
  many call sites depend on them.
- The idle sweep must be left alone. It deliberately skips translating turns
  (`translation-session.service.ts:491`); per-call deadlines are what make that safe, and a
  second reaper could cut a legitimately slow turn.

## Architecture

Timeouts belong in the provider layer, not the session layer, because that is where the
`fetch` lives and where the error type is already mapped. The repo already uses the exact
idiom at `apps/api/src/modules/storage/google-avatar-importer.ts:99`
(`signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)`), so this is a local convention, not a new
dependency.

`packages/ai-providers/src/providers/http-util.ts` already holds the shared fetch helpers
(`truncate`, `extFromMime`), which makes it the DRY home for the timeout constants.

Speculation in-flight capping belongs in `TurnSpeculation`, which already owns the spend
decision ("everything here is a spend decision against a metered API"). `canRenew` today
checks only staleness and the count; it has no notion of settledness. The guess promise
already has a `.catch` attached in `start`, so marking settled is a `finally` on the same
promise — no new machinery.

Note the ordering constraint: a superseded guess is dropped but **never cancelled** (the
pipeline has no cancellation), so capping in-flight guesses is the only way to stop the
waste; it cannot be reclaimed after the fact.

## Related Code Files

- Modify: `packages/ai-providers/src/providers/http-util.ts` — add the timeout budgets (and, if it reads cleanly, a small `fetchWithTimeout` wrapper)
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-stt-provider.ts` — `/transcribe` fetch (~line 53), 5000ms
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-embedding-provider.ts` — `/embed` fetch (~line 52), 5000ms
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-tts-provider.ts` — `/synthesize` fetch (~line 103), 15000ms
- Modify: `packages/ai-providers/src/providers/gemini/key-rotation.ts` — `new GoogleGenAI({ apiKey })` in the constructor, add `httpOptions: { timeout: 20_000 }`
- Modify: `apps/api/src/modules/translate/session/turn-speculation.ts` — `canRenew` gains an in-flight check; `start` marks settled
- Modify: `apps/api/src/modules/translate/session/turn-speculation.spec.ts` if present, else add coverage in the session service spec

## Implementation Steps

1. Add the four timeout budgets to `http-util.ts` as named constants, each with a one-line
   comment stating the measured cost it is sized against. Decide at this point whether a
   `fetchWithTimeout` wrapper earns its place or whether four inline `signal:` lines are
   simpler — prefer the wrapper only if all four call sites genuinely share error mapping.
2. Add `signal: AbortSignal.timeout(...)` to the three local-speech fetches. Confirm each
   provider's existing `catch` maps an `AbortError` onto `ProviderConnectionError` rather
   than leaking a raw `DOMException`; add the mapping if it does not.
3. Pass `httpOptions: { timeout: 20_000 }` into the `GoogleGenAI` constructor in
   `key-rotation.ts`. Verify against the installed `@google/genai` version that
   `httpOptions.timeout` is the supported field name before committing to it — if the SDK
   spells it differently, use the SDK's own field and note it in the commit body.
4. In `TurnSpeculation`, track whether `current` has settled. Add `settled` to the `Guess`
   shape, set it from a `finally` on the same promise that already gets `.catch`, and make
   `canRenew` return `false` while an unsettled guess exists.
5. Add tests: one per provider asserting rejection within budget against a never-resolving
   stub, and one asserting `canRenew` is false while a guess is unsettled and true again
   after it settles.
6. Run the narrowest suites first (`pnpm --filter api test`), then broaden to lint,
   typecheck and build since the provider package is a shared contract.

## Success Criteria

- [x] `grep -rn 'fetch(' packages/ai-providers/src/providers/local-speech/` shows a deadline on every call
- [x] `GoogleGenAI` is never constructed without a timeout
- [x] A never-responding sidecar produces `ProviderConnectionError` within budget + 200ms
- [x] ~~`canRenew` is false while a guess is unsettled; at most one speculation in flight per turn~~ — implemented, then **reverted**: the specs proved renewal suppression costs the measured head start. See Requirements for the full record.
- [x] A hung dependency fails its own turn and frees the slot; no api log row shows a turn translating past ~40s
- [x] `pnpm --filter api test` green; lint, typecheck and build green

## Risk Assessment

**A timeout that is too tight cuts working calls.** That would be a worse bug than the one
being fixed — a user would lose turns that were merely slow. Budgets are therefore set
2–5× above measured worst cases (Gemini 20s against a measured 8943ms max). Signal it
broke: turns failing with a connection error while the sidecar log shows the decode
completing normally. Pre-decided response: raise that budget, do not remove the deadline.

**`httpOptions.timeout` may not be the SDK's field name.** Step 3 verifies it against the
installed version rather than assuming. If the field differs or does not exist, the
fallback is wrapping the call in `Promise.race` with an explicit timer — uglier, and it
does not abort the underlying request, so prefer the SDK field if it exists at all.

**Capping speculation could cost the measured head start.** The in-repo measurement is
870ms to first audio when a guess is reused versus 1760ms when it is lost, and
`MAX_SPECULATIONS_PER_TURN = 4` is a measured decision that must not be reversed on an
abstract concern. This phase does **not** lower that cap; it only prevents guesses from
overlapping, which is waste rather than head start — an overlapping guess is invalidated
by the very next audio frame (~21ms later). Signal it broke: speculation hit-rate falling
below the recorded ~59% baseline. Pre-decided response: revert this step alone and keep
the timeouts, which are independent.

**`packages/ai-providers` has no test harness.** Adding vitest there is new scaffolding
for that package. See plan open question 3 — the alternative is asserting the timeouts from
`apps/api`, which already runs vitest.
