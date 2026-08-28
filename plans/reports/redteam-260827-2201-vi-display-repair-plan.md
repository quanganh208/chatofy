---
type: redteam
date: 2026-08-27
plan: plans/260827-2150-vi-transcript-display-and-turn-merge
verdict: Phase 4 GO branch unsound on the dominant path; Phases 2/3/6 sound as-is
---

# Red-team — Vietnamese display repair plan

Adversarial review of the plan, plus my own verification of every load-bearing
claim. Findings the controller verified in source are marked VERIFIED.

## The structural finding — early-forwarding cannot serve the dominant path

`translation-model-policy.ts:69` (VERIFIED, verbatim): "**three turns in four now
reuse a guess**, the endpoint itself rarely calls at all".

Both wirings of the early-forward callback fail:

| Wiring                                | Failure                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Callback plumbed to `speculate()`     | Discarded guesses fire it. `turn-speculation.ts:51-53` drops superseded guesses "unawaited and uncancelled", so there is no cancellation. TTS begins speaking an utterance the speaker then continued. |
| Callback NOT plumbed to `speculate()` | Never fires on 75% of turns. Field-2 tokens are still generated inside the speculation and awaited at `end()`, so the latency is paid with no benefit.                                                 |
| Field 2 only on the final request     | 75% of turns never make one — most turns get no repair.                                                                                                                                                |

Consequence: **Phase 1's chunk-timing bench governs at most 25% of turns.**
Spending quota on it buys little.

## Blocking findings against the GO branch

- **B1 — ghost clauses from the retry ladder.** `gemini-translation-provider.ts:146-174`:
  `generate()` runs once per (model, key) attempt and throws AFTER its stream loop
  when the body is empty (`:302`). Fire-once-per-call → attempt 1 forwards E1 and
  throws, attempt 2 returns E2; TTS spoke E1, the transcript persists E2, and
  **the listener heard text that is not in the transcript**. Fire-once-per-attempt
  → the clause is spoken twice from two models. The controller's "commitment rule"
  amendment addresses this, but only for the non-speculative path.
- **B3 — display events from discarded speculations.** A guess made at 4s of an
  11s utterance would emit `server.transcript.display` for a partial utterance.
  Under `displayText ?? sourceText` (last-write-wins, pure derivation) a late stale
  event permanently overwrites a good line.
- **B4 — `turns` is completion order, not speaking order.** VERIFIED:
  `turn-keyed-transcript.ts:341` appends on arrival; `MAX_IN_FLIGHT = 3`. A ladder
  walk on part A while part B reuses a guess yields `turns = [B, A]` — the merged
  utterance renders backwards. The reducer concedes it at `:366`.
- **B5 — no utterance clock.** `TranscriptSegment.createdAt` is set at
  `turn-session.ts:255` when the SERVER finished translating. The gap between two
  segments is the difference of two translation durations — seconds, sometimes
  negative. `openedAt` on `CapturedTurnMetrics` (`turn-pipeline.ts:298`) is real
  capture time and should be carried instead.
- **B6 — field 2 leaks into every caller of the shared instruction.**
  `LivePreview.translateLive` (`live-preview.ts:125`) issues a request per partial
  on the same flash model. `translation-model-policy.ts:66-73` records what
  bunching on that model already cost: "seven rate limits over thirty-two turns,
  and one request came back after fifteen seconds." Field 2 must be opt-in per request.

## High

- **H1 — delimiter × `stripTranscriptTags`.** `TRANSCRIPT_TAG = /<\s*\/?\s*transcript\b[^>]*>/gi`.
  `<transcript-vi>` is STRIPPED (the `\b` matches at the hyphen), silently merging
  the two fields; `<vi>` is not stripped and, if echoed into field 1, is **spoken
  aloud** — `prompt-builder.ts:88` records this as measured, not hypothetical, for
  Gemma. Required: split fields FIRST, strip each SECOND, add the delimiter to the
  strip set.
- **H2 — early-forwarded text bypasses the strip and the emptiness guard**, both of
  which run after the stream loop (`:298-305`).
- **H3 — the stated callback signature cannot carry what `transcript.final` needs.**
  `session.toSegment(sourceText, targetText)` needs `sourceText`, unavailable at
  provider level until `transcribeAndTranslate` returns.
- **H5 — `en_to_vi` is unhandled.** Field 2 repairs the SOURCE transcript, which in
  that direction is English. Direction appears nowhere in any phase.
- **H6 — adding a server event is version-coupled.** `translate-socket.ts:108-110`
  `safeParse` → `onError('Unexpected event shape from the server')`. A tab left open
  across a deploy errors on every repaired turn.

## Controller errors the review caught (both VERIFIED and now fixed in the plan)

1. **`closedMetrics` is keyed by `turnId`, not `sessionId`** (`turn-pipeline.ts:165,291,499`),
   and `sessionId` is `string | null` on the value (`:151`). The held-then-cut turn —
   the common case under an 8s ceiling with `MAX_IN_FLIGHT = 3` — has no join key at
   snapshot time. `conversation-session.ts:587` already early-returns on it.
   Also a timing gap: `cutForced` reaches the app via `forget()` (`:507`), AFTER
   `server.transcript.final`.
2. **Only one `implements TranslationProvider` exists** (Gemini). The risk row naming
   elevenlabs / gemini-live / local-speech was fiction, and the architecture argument
   resting on it ("would break every other provider") was unsound — though its
   conclusion may still hold for caller-churn reasons.
3. `conversation-transcript.spec.tsx` does not exist; it is a Create, and the
   component has **zero** test coverage today.
4. Phase 5's `0.5d` estimate was wrong by a multiple — corrected to 2d.

## Unfalsifiable criteria (cannot fail as written)

- "Flash-bucket requests per turn unchanged from 1.84" — the GO design adds zero
  requests by construction. The real cost is tokens-and-duration per request.
- "VIVOS vi WER unchanged at 5.38%" — the benchmark runs STT offline; the translate
  path is not in it. (The `segment.sourceText` criterion DOES bite — keep that one.)
- "Translation turn count and cutForced rate unchanged" (render-only phase);
  "STT stage ≈58ms" (nothing here touches STT); "git diff touches no VAD constant".
- The amended p50 gate CAN fail — but on the 75% reused path the added tokens land
  inside the speculation, which completes before `end()`, so the cost is invisible
  to e2e p50 on exactly the turns where it is paid.

## Sound as-is

Phases 2, 3 and 6 — independent, factually accurate, no changes required.
Phase 2's VIVOS table was re-run by the reviewer and confirmed exactly: 50 rows,
0 with a digit, 0 with punctuation, 50 uppercase.

## Unresolved questions

1. On a reused speculation, does the repair come from the speculation's own
   response or a fresh request? Determines whether Phase 1 measures anything real.
2. May `POST /translate`'s response contract change? If field 2 is not parsed out
   inside `generate()`, REST TTS speaks the delimiter.
3. When a merged group's members are later attributed to different speakers and the
   group splits, does the chip vanish — and does the one-accent-per-screen rule in
   `.claude/rules/development-rules.md` still hold across the split?
4. Which critical path is real: `open question 1 → Phase 2 → Phase 4`, or `Phase 5 → Phase 4`?
