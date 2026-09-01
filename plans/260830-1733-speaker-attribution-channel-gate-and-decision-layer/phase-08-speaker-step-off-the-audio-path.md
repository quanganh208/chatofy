---
phase: 8
title: 'Speaker step off the audio path'
status: cancelled
priority: P3
effort: '0.5d'
dependencies: []
---

# Phase 8: Speaker step off the audio path

## WITHDRAWN — 2026-09-01, after red team

**This phase's premise was false. Do not implement it.**

`embedSpeaker` is started **eagerly** at
`apps/api/src/modules/translate/services/translation-session.service.ts:293-299`,
before `transcribeAndTranslate` is awaited. The shipped comment states the intent
directly:

> _"Started HERE, beside the translation rather than after it. The sidecar
> exposes a second endpoint precisely so this cost overlaps work that was
> happening anyway; awaited at the call site it would become serial and buy
> nothing."_

So the embedding already overlaps the translation. Against a p95 translation of
1947ms, even `eres2netv2` (p95 555.8ms @2s) is fully hidden. **No latency ceiling
follows from where the `await` sits, and there is no budget to free.** Everything
below that reasons from "the ~200ms ceiling is a consequence of where this
statement sits" is wrong.

The proposed change is also actively harmful:

- `streamClauses` awaits TTS synthesis **per clause, sequentially** (`:638-671`).
  Moving the `await` below it delays the vector by **seconds**, not the ~20ms this
  phase priced.
- The emit is guarded by `if (vector && this.registry.holds(socket, session))`
  (`:350`). After the move that guard is evaluated post-delivery, so a user who
  stops during the last turn's playback gets **no vector at all** — and under D8
  that row can never leave pending. The phase would break the guarantee it was
  written alongside.
- The await still sits above `record()` (`:390`) and `close()` (`:391`), and
  `close()` is what releases the concurrency slot. The ceiling would be loosened,
  not removed.
- Its planned spec "an embedding that rejects does not prevent translated audio"
  tests an unreachable state: `PipelineTranslatorService.embedSpeaker` is
  documented **"Never throws, and that is the contract"** and returns `null` in its
  catch (`pipeline-translator.service.ts:148-175`).

**One real defect was found on this path and is NOT withdrawn — it is promoted.**
`LocalSpeechEmbeddingProvider.embed` calls `fetch` with **no timeout and no
`AbortSignal`** (`local-speech-embedding-provider.ts:52`). A sidecar that accepts
the connection and never responds leaves the turn's `await` pending forever;
`sweepIdleTurns` skips it (`if (!session.isListening) continue;`, `:491`), and
`close()` is the only caller that releases the registry slot (`:703-711`). Six
hung embeds exhaust `MAX_CONCURRENT_TURNS_GLOBAL = 6` and `/ws/translate` — which
takes no authentication — returns `too_many_turns` to every client. **That is an
unauthenticated denial of service and it is independent of this plan.** It should
be filed and fixed on its own, with an `AbortController` in the provider rather
than a `Promise.race` in the caller.

Everything below is retained as the record of a withdrawn proposal.

---

## Overview

Move one `await` so the speaker embedding stops blocking translated audio.

The phase buys no accuracy. It buys **budget**: the ~200ms ceiling that closed
the heavy-model axis is a consequence of where this statement sits, not of any
requirement. Moving it converts that ceiling into "how late may a chip appear",
which is a different and far looser question.

Independent of every other phase — `dependencies: []` — and separable enough to
ship or revert on its own.

## The current ordering

`apps/api/src/modules/translate/services/translation-session.service.ts`:

| line | statement                                        |
| ---- | ------------------------------------------------ |
| :337 | emit `server.transcript.final`                   |
| :349 | `const vector = await embedding;`                |
| :352 | emit `server.turn.embedding`                     |
| :362 | `const delivery = await this.streamClauses(...)` |

The transcript is emitted before the await, so the _transcript_ is not blocked.
**The translated audio is.** `streamClauses` cannot start until the embedding
resolves, so every millisecond the embedder spends is a millisecond the user
waits to hear the translation.

Measured cost today, campplus at `extractor_threads=2`:

| cell                 | p50     | p95     |
| -------------------- | ------- | ------- |
| 1.0s, idle           | 10.1 ms | 11.7 ms |
| 1.0s, contended-stt4 | 15.1 ms | 20.0 ms |
| 2.0s, contended-stt4 | 23.5 ms | 30.4 ms |

At the real turn length this is small. It is not small for anything heavier:
`eres2netv2` is 4.5x campplus, and the whole reason the model axis reads as
closed at ~200ms is that the budget is being spent on the audio path.

## What this does and does not claim

**Does:** removes the embedding from the translated-audio critical path.

**Does not:** claim a specific end-to-end improvement. At 1.0s the embedder costs
p95 ~20ms against an end-to-end p95 of 2983ms whose tail is owned by the
translation API (p95 1947ms). **The user-visible latency win today is within
noise, and the phase must not be reported as a latency win.** The deliverable is
the freed budget, which only becomes valuable if a later phase spends it.

That honesty matters for the success criteria below: this phase is verified by
_where the await sits_ and by the absence of regression, not by a stopwatch.

## Requirements

**Functional**

- The embedding no longer gates `streamClauses`.
- `server.turn.embedding` still emits, still after `server.transcript.final`,
  and still carries the same payload — no wire change, so plan constraint C8's
  per-client opt-in is untouched.
- A turn whose embedding never resolves still delivers audio, and emits no
  embedding event rather than hanging.

**Non-functional**

- Bounded wait: a detached embedding gets a hard timeout. On timeout the turn
  proceeds with no embedding event; the client's existing `fallback` path already
  handles an absent vector.
- No unhandled rejection when a detached embedding rejects.
- No change to `SPEAKER_EMBEDDING_ENABLED` semantics.

## Architecture

Two viable shapes. Prefer the first.

**A — move the await below `streamClauses`.** Smallest diff, keeps the emit
ordered after delivery starts, keeps error handling in one place. The embedding
still resolves within the turn handler, so lifetime is unchanged.

**B — detach with `embedding.then(emit)`.** Lower latency for the chip, but
introduces a floating promise whose lifetime outlives the turn handler and
therefore needs explicit cancellation on session end.

**A is the recommendation.** B's benefit is a chip arriving a few tens of
milliseconds earlier, which no requirement asks for, at the price of lifetime
management on a session that can end mid-turn. Choose B only if a later phase
adds a model heavy enough that A's ordering reintroduces a wait.

## Related Code Files

- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`
  — reorder `:349` below `:362`; add the timeout
- Modify (test): the session-service spec covering turn delivery — add the two
  cases in Success Criteria
- Read only: `packages/realtime-client/src/state/speaker-roster.ts` — confirms
  `fallback` already covers an absent vector

## Implementation Steps

1. Read the surrounding turn handler in full. The reorder is one statement; the
   error and cleanup paths around it are not, and they are what can break.
2. Move `const vector = await embedding;` and the `server.turn.embedding` emit
   below the `streamClauses` await.
3. Add a bounded timeout on the embedding. On timeout, skip the emit and record
   the turn outcome honestly — do not synthesise a vector.
4. Add the two specs: audio delivered when the embedding rejects; audio delivered
   when the embedding exceeds the timeout.
5. Run the narrowest suite first (session service), then broaden to the API
   package since a shared turn path changed.

## Success Criteria

- [ ] `await embedding` occurs after `streamClauses` in the turn handler
- [ ] Spec: an embedding that **rejects** does not prevent translated audio
- [ ] Spec: an embedding that **exceeds the timeout** does not prevent translated
      audio and emits no embedding event
- [ ] `server.turn.embedding` still emits after `server.transcript.final` on the
      success path, with an unchanged payload
- [ ] No wire-contract change — diff touches no file under `packages/types`
- [ ] Existing session-service specs pass unchanged
- [ ] The phase report states the freed budget and explicitly does **not** claim
      a user-visible latency improvement

## Risk Assessment

| Risk                                       | Signal it broke                                                        | Pre-decided response                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reordering changes turn-outcome accounting | A turn that previously recorded one outcome now records another        | This path was just repaired (`outcomeFor()` fall-through, commit `505c247e`). Re-read that fix before editing and assert outcomes in the new specs |
| Floating promise if shape B is chosen      | Unhandled rejection after session end                                  | Prefer shape A. If B is ever needed, cancellation on session end is a requirement, not a follow-up                                                 |
| The freed budget is never spent            | Phases 2/6 conclude without a heavier model or a second per-turn model | Acceptable. The phase costs half a day and removes a false constraint from the record either way                                                   |
| Reported as a latency win                  | Any report or commit message claims faster end-to-end                  | Correct it. p95 ~20ms against an end-to-end p95 of 2983ms is noise; the deliverable is budget, not speed                                           |
