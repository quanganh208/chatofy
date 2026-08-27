---
phase: 4
title: 'Vietnamese display repair'
status: pending
priority: P1
effort: '2d'
dependencies: [2, 5]
---

# Phase 4: Vietnamese display repair

## Overview

Put a punctuated, cased, ITN'd Vietnamese line on screen without touching the
audio path, the translate request, or the speculation machinery — via a separate
fire-and-forget repair request on a separately-metered model bucket.

## Why this design, and what it replaced

The original design added a second output field to the existing translate request
and forwarded the English early so TTS start was untouched. **Red-team killed it,
and the reason is structural, not tunable.**

`translation-model-policy.ts:69` records: "**three turns in four now reuse a
guess**, the endpoint itself rarely calls at all." Every wiring of an
early-forward callback fails on that dominant path:

| Wiring                            | Failure                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callback on `speculate()`         | `turn-speculation.ts:51-53` drops superseded guesses "unawaited and uncancelled" — no cancellation exists. TTS starts speaking an utterance the speaker then continued. |
| Callback not on `speculate()`     | Never fires on 75% of turns, while field-2 tokens are still generated inside the speculation and awaited at `end()`. Latency paid, nothing bought.                      |
| Field 2 on the final request only | 75% of turns never make one. Most turns get no repair.                                                                                                                  |

Plus, on the non-speculative path, the model ladder
(`gemini-translation-provider.ts:146-174`) calls `generate()` once per (model,
key) attempt and throws AFTER the stream loop. An attempt could forward English
E1, throw, and be retried into E2 — **the listener hears text that is not in the
transcript.**

The route below deletes all of it: no callback, no early forwarding, no
speculation interaction, no delimiter in the translate response, no change to
the shared instruction, no new concurrency in a strictly sequential service.

## Architecture

**One extra request per completed turn, off the critical path entirely.**

1. **Trigger.** After the turn's transcript is final — whichever path produced the
   translation, reused speculation or endpoint call. The repair never rides the
   translate request and is never issued for a speculation.
2. **Its own prompt.** A repair-only instruction, NOT `buildTranslationInstruction`.
   Same data-block discipline (`wrapTranscript` / `asTranscriptData` /
   `stripTranscriptTags`), but the task is: _rewrite this machine transcript in its
   own language with correct punctuation, capitalization and numerals; change no
   words._ Keeping it separate is what leaves `LivePreview.translateLive`
   (`live-preview.ts:125`, one request per partial) and `POST /translate`
   completely untouched.
3. **Its own model bucket.** `gemma-4-31b-it`. Quota is metered per project **per
   model**, so this costs the flash path zero RPM contention — which is the
   constraint that actually matters, since the per-minute ceiling is what a live
   conversation hits. `translation-model-policy.ts:66-73` records what bunching on
   the flash model already cost: "seven rate limits over thirty-two turns, and one
   request came back after fifteen seconds."
4. **Direction-aware.** The thing repaired is the **source** transcript: Vietnamese
   for `vi_to_en`, **English for `en_to_vi`**. Both directions get a repair; only
   the Vietnamese one is scored by Phase 2's metrics. Do not assume Vietnamese
   anywhere in the implementation.
5. **Delivery.** On resolution, emit `server.transcript.display { sessionId, text }` —
   provisional, replace-wholesale, exactly the documented semantics of
   `server.transcript.partial` / `server.translation.partial`
   (`ws-events.ts:276-303`). Fire-and-forget: on any failure, emit nothing and the
   display stays raw.

**Rendering contract shared with Phase 5 — written identically in both files.**
The reducer stores `displayText` keyed by `sessionId`, one per member turn;
rendering reads `displayText ?? sourceText`. Grouping stays a pure derivation, so
a repair may arrive for any member of a merged group at any time and the block
re-renders. Merging must never become stateful.

**Accepted cost, stated plainly.** Gemma is ~6.9s, so polish lands several
seconds after the turn rather than ~1s. Acceptable because this is display text
beside already-playing audio — in that window the listener is listening, not
reading. It mostly improves scrollback. That is honest half-value and it is what
buys the entire blocker list above.

## Divergence guard — ITN-masked residual distance

Guards against MT _paraphrase_: a mis-recognized `ngọt` silently becoming a
confident `ngập` the speaker never said.

A naive edit-distance threshold does not work. ITN is inherently high-distance:
`mười bảy giờ` → `17:00` collapses 3 tokens into 1, so a 10-token turn with one
clock time already moves ~30%, and the reproduction passage carries three ITN
spans. A flat 25% guard would reject the feature on its own demo.

1. Canonicalize both sides: `normalizeTranscript` + `.toLowerCase()`.
   **Never `foldForMatch`** — `packages/ai-providers/src/text/vietnamese.ts` says
   in its own header that it strips combining marks and is "NEVER sent anywhere",
   folding `má`/`mà` together. Using it would blind the guard to exactly the
   tone-substitution case it exists to catch. Name it here because an implementer
   will otherwise reach for the existing helper.
2. Align tokens. Zero-cost any aligned edit whose raw side is entirely
   closed-class Vietnamese number/unit words (`không một hai ba bốn năm sáu bảy
tám chín mười trăm nghìn triệu phẩy giờ phút giây mét phần` …) AND whose
   repaired side contains a digit.
3. Threshold the residual — which now measures only content-word substitution.
4. **Calibrate on Phase 2's set**, do not hard-code from this document. Every
   (raw, hand-reference) pair is a known-legitimate repair: the guard must pass
   all of them, then be shown to reject synthetic paraphrases. Commit the number
   with its evidence.

Known limitation to state in code: step 1 strips casing and punctuation, so the
guard cannot detect a repair that mangles _those_. Correct for a paraphrase
guard; say so.

## Failure semantics

| Condition                                          | Behavior                                          |
| -------------------------------------------------- | ------------------------------------------------- |
| Repair request fails, times out, or 429s           | Emit nothing. Display stays raw. Turn unaffected. |
| Repair returns empty or garbled                    | Emit nothing. Display stays raw.                  |
| Repair exceeds the calibrated divergence threshold | Reject. Display stays raw.                        |
| Translate path fails                               | Unchanged from today. The repair is not involved. |

Nothing here can fail a turn, delay audio, or block anything. That is the point.

## Related Code Files

- Create: `packages/ai-providers/src/providers/gemini/transcript-repair-prompt.ts`
- Create: repair-guard module (ITN-masked divergence), with tests
- Modify: `packages/ai-providers/src/interfaces/` — a repair entry point distinct from `translate`
- Modify: `packages/types/src/events/ws-events.ts` (new display event)
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` (issue repair after final; emit on resolution)
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` (reducer case, `displayText` by sessionId)
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` (expose `displayText`)
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx` (normalized line + raw toggle)
- Modify: `apps/api/src/modules/translate/session/turn-timeline.ts`, `services/turn-metrics.recorder.ts` (repair-latency metric)
- Re-run + extend: `benchmarks/prompt-injection`

## Implementation Steps

1. Write the repair prompt and its own provider entry point, pinned to
   `gemma-4-31b-it`. Do NOT touch `buildTranslationInstruction`.
2. Add the display event to the ws contract and the reducer, keyed by `sessionId`.
3. **Resolve the version-coupling question before emitting.** `translate-socket.ts:108-110`
   `safeParse`s into a strict discriminated union and calls
   `onError('Unexpected event shape from the server')` on failure — so a tab left
   open across a deploy would error on every repaired turn. Either gate emission on
   a capability the client declares in `client.session.start`, or accept the
   deploy-window error and say so. Decide, record, do not leave implicit.
4. Issue the repair after `transcript.final`, for final turns only, never for a
   speculation. Assert that in a test.
5. Implement the ITN-masked guard; calibrate on Phase 2's set; commit the number.
6. Render: normalized line as the display, raw behind a toggle, visibly marked.
7. Handle both directions. `en_to_vi` repairs English.
8. Instrument time-from-transcript-final to display-repair.
9. Extend `benchmarks/prompt-injection` with **same-language-rewrite** cases — the
   existing corpus tests translation-direction injection and may not cover a field
   that asks the model to rewrite the transcript in its own language. Re-running the
   old corpus green would prove little.
10. Score against Phase 2's set; compare to the recorded zero baseline.
11. Confirm flash-bucket output tokens per turn are unchanged — this design adds no
    flash traffic at all.

## Success Criteria

- [ ] Phase 2 metrics: numerals ≥0.85, punctuation F1 ≥0.70, proper-noun capitalization ≥0.80
- [ ] Repair never issued for a speculation — asserted by test
- [ ] Repair failure/timeout/429 leaves the display raw and the turn unaffected — test per failure row
- [ ] Divergence threshold calibrated on Phase 2's set, committed with evidence
- [ ] Guard passes the reproduction passage (3 ITN spans) and rejects synthetic paraphrase
- [ ] Guard uses `normalizeTranscript` + lowercase, NOT `foldForMatch` — asserted by a tone-pair test (`má`/`mà`)
- [ ] `en_to_vi` repairs English; both directions covered
- [ ] Zero added flash-bucket traffic; e2e p50 unchanged within noise (no mechanism to move it)
- [ ] `segment.sourceText` still carries RAW text — verified in the persisted record
- [ ] Repaired text never reaches the benchmark or the metrics
- [ ] `benchmarks/prompt-injection` extended with same-language-rewrite cases and green
- [ ] Raw transcript reachable and visibly marked distinct from the normalized line
- [ ] Version-coupling decision recorded and implemented

## Risk Assessment

- **Gemma repairs content, not just formatting.** Signal: the divergence guard
  firing often, or a spot-check showing changed words. Response: the guard rejects
  and shows raw; frequent firing means the prompt asks too much and must be
  narrowed to formatting only.
- **Repaired text leaks into the benchmark or `segment.sourceText`.** Given 0/50
  VIVOS references carry a digit, ITN'd text in the WER path would make the headline
  5.38% _worse_ while the display got better. Signal: VIVOS WER moves at all.
  Response: it must not — raw stays the only metric input, and raw (not repaired)
  feeds MT context history.
- **The repair cools the REST reserve.** The provider keeps one shared cooldown map
  (`gemini-translation-provider.ts:131-134`), so a repair 429 cools that (key, gemma)
  pair for `POST /translate` too — which uses Gemma as its last resort. Signal: REST
  translate failing after repair traffic. Response: measure it; if real, give the
  repair its own key or accept REST's reserve degrading under live load.
- **New injection surface, genuinely new in kind.** Asking a model to rewrite the
  source in the source language is much closer to "do what the transcript says" than
  "translate it". Signal: `prompt-injection` regressions on the new cases. Response:
  it is a gate, not a report.
- **Quota.** +1 Gemma request per completed turn against 14,400/day. Comfortable, but
  it is real spend on a thin overall budget. Signal: Gemma 429s. Response: batch
  repairs during silence gaps, or repair only turns the user is looking at.

## Thesis note

Instrument **time-from-transcript-final to display-repair** as its own metric.
"Polished display N ms after the turn, at zero first-audio cost, on a separately
metered bucket" is a stronger comparison-chapter row than the fix itself — it
turns the defect into a demonstrated architecture decision, including the
early-forwarding design that was measured, understood, and rejected on evidence.
