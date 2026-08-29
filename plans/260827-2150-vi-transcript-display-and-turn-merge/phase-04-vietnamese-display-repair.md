---
phase: 4
title: 'Vietnamese display repair'
status: superseded
priority: P1
effort: '2d'
dependencies: [2, 5]
---

# Phase 4: Vietnamese display repair

> **SUPERSEDED 2026-08-29. The code described below is deleted.** Replaced by
> [`260829-2039-vi-display-itn-and-gemma-removal`](../260829-2039-vi-display-itn-and-gemma-removal/plan.md):
> a deterministic in-process ITN reaching recall **1.0000** (against this phase's
> 0.8810) with 0 hallucinations at **0.21 ms p95**, instead of a median 25.1 s.
> Rejected for LATENCY, not correctness — everything below was measured and true.
> The cost of the replacement is recorded there and is real: punctuation F1 and
> proper-noun capitalization both fall to 0.0000.

## Result (2026-08-28)

Shipped. All three display metrics moved off the recorded zero and cleared their
gates, measured on what a reader SEES — the divergence guard's rejections
included, falling back to raw.

| Metric                     | Baseline | Repaired   | Gate  |
| -------------------------- | -------- | ---------- | ----- |
| numeral recall             | 0.0000   | **0.8810** | ≥0.85 |
| punctuation F1             | 0.0000   | **0.7222** | ≥0.70 |
| proper-noun capitalization | 0.0000   | **0.8636** | ≥0.80 |
| numeral hallucinations     | 0        | **0**      | —     |

Guard: **`MAX_REPAIR_DIVERGENCE = 0`**, and that is a measurement rather than a
stance — all 22 corpus repairs scored a residual of exactly 0.0000 once numeral
rewrites are exempted, so there was no tolerance to buy. It rejected 2 of 22,
both correctly (a duration written as a clock time, and a dropped `ngày`).

### Four things that were not true when this phase was written

1. **Latency is an order of magnitude worse.** Median **25.1s**, max **92.6s** —
   not the ~6.9s taken from the model's p50 on a one-sentence translation. A
   repair prompt is far longer and its output is a whole utterance. Nothing on
   the audio path waits, so this costs scrollback polish rather than a
   conversation, but "several seconds after the turn" is wrong.
2. **A repair needs a concurrency ceiling of its own.** It outlives its turn by
   ~25×, so with continuous capture a speaker produces them faster than they
   retire. `MAX_CONCURRENT_DISPLAY_REPAIRS = 8`; over it the turn keeps raw text.
3. **The version-coupling question answered itself.** `embedSpeaker` had already
   solved it in the same schema file, with the reasoning written out: an
   opt-in per client. `repairDisplay` copies it exactly rather than inventing a
   second mechanism.
4. **Step 2 was already done.** Phase 5 left `displays`, the reducer slot and
   `groupSourceText(group, displays)` in place. The placeholder client action
   `transcript.displayRepaired` was REMOVED — with a real server event producing
   the state, keeping both would be two ways to do one thing.

### The one finding worth carrying out of this phase

The first scored run came back at 0.64 recall with **26 apparent hallucinations**
— and every one of the 15 misses and 26 extras was a formatting convention, not
an invented number: `17 giờ` against a reference of `17:00`, `ngày mùng 2 tháng 9
năm 1945` against `2/9/1945`. All correct Vietnamese. **A convention only one
side knows is not a convention**; stating it in the prompt moved recall 0.64 →
0.88 and hallucinations 26 → 0.

That is also the README's reformat warning arriving in practice: a reformat costs
a recall miss AND a hallucination, and here it was the whole signal.

### What review caught that measurement did not

The divergence guard let a span be vouched for by number vocabulary sitting
BESIDE it, and that vouch accepted filler words — so `tôi không đồng ý` → `Tôi 0
đồng ý.` was accepted at residual **exactly 0**. The negation digitized, on
screen as the speaker's own words, meaning reversed. That is the failure class
the guard exists for.

**The suite was green through it.** It held one `không` case, and that case
happened to pick the one neighbour outside the vocabulary — it passed on an
accident rather than on the rule. Now `it.each` over four neighbours, because the
neighbour is what decides the outcome.

Fixed with a `neverAlone` set — and then the fix turned out to be **half of one**.
Attacking it with 27 adversarial cases (rather than reasoning about the change)
found two ordinary sentences still walking through at residual 0: `hai mươi không
đủ` → `20 0 đủ.` and `lúc mười giờ không phải mười một giờ` → `Lúc 10:00 0 phải
11:00.` There `không` is not vouched for by a neighbour at all — it is swept INTO
a span that already contains a counting word and rides on someone else's
justification. Blocking one vouching path left the other open.

Review then found the case that defeats context entirely: `nó không trăm phần
trăm đúng` → `Nó 0 100 phần trăm đúng.` ("not 100% correct"). The thing being
negated is ITSELF a number, so `không` abuts a numeral the repair is already
rewriting — and `không trăm` is lexically identical to a zero heading a numeral.
No context rule can separate them, and by then I had written two that tried.

What separates them is SHAPE: a genuine spoken zero is absorbed INTO its numeral
(`không phẩy bốn` → `0,4`) and never stands alone; a digitized negation always
does. `neverAlone` became a map from word to the bare numeral it must never
become, consulting no neighbours. One line, subsuming both earlier rules, which
were deleted rather than stacked — and it generalizes to English, where review
found the same shape misfiring on `a`, `second`, `march`, `may`.

**Three fixes for one bug class, each defeated by the next case.** Corpus scores
byte-identical throughout.

Also from review: no request timeout (8 hung repairs would disable the feature
process-wide, permanently and silently) → 120s deadline against a 92.6s measured
max, plus tests proving the slot is released on success AND on failure;
`repairDisplay()` had no tests at all → a 9-case spec; metrics were recorded
before the emit, so a throwing sink could swallow a successful repair → emit
first.

### Honest limitations

- **The numbers are partly in-sample.** The prompt was revised twice against this
  22-utterance corpus. Fitted, not held out; quote it that way.
- One speaker, one language direction scored. `en_to_vi` repairs English through
  the same path with its own vocabulary, tested but not corpus-calibrated.
- The guard compares WORDS. It cannot detect a repair that mangles punctuation or
  casing — correct for a paraphrase guard, and stated in the module.
- `anh ba năm nay không đi` → `Anh 3 năm nay không đi.` still accepts: `ba` as a
  personal name, not separable lexically from `cổng số ba` → `cổng số 3`, which
  is a real corpus row.
- Repair slots are process-wide with no per-socket share, so one continuous
  session can starve the others of polish. Deliberate while concurrency is small;
  the fix is a share of the number, not a bigger number.
- **Never run end to end in a real browser.** Provider proven on 22 recordings,
  render path proven by component and reducer tests — but nobody has spoken into
  a microphone and watched the line change.

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

- [x] Phase 2 metrics: numerals ≥0.85, punctuation F1 ≥0.70, proper-noun capitalization ≥0.80 — 0.8810 / 0.7222 / 0.8636
- [x] Repair never issued for a speculation — asserted by test, and true by construction: the only call site is after `transcript.final`
- [x] Repair failure/timeout/429 leaves the display raw and the turn unaffected — one test per failure row, plus one for a rejected promise
- [x] Divergence threshold calibrated on Phase 2's set, committed with evidence — 22/22 at exactly 0.0000, so the threshold IS 0
- [x] Guard passes the reproduction passage (3 ITN spans) and rejects synthetic paraphrase
- [x] Guard uses `normalizeTranscript` + lowercase, NOT `foldForMatch` — tone-pair test (`má`/`mà`), which also caught the ASCII-`\w` tokenizer bug
- [x] `en_to_vi` repairs English; both directions covered — own vocabulary, own instruction, tested
- [x] Zero added flash-bucket traffic; e2e p50 unchanged within noise — pinned to `gemma-4-31b-it` alone, asserted by test
- [x] `segment.sourceText` still carries RAW text — asserted against the emitted segment
- [x] Repaired text never reaches the benchmark or the metrics — it is never written to `turns`, only to `displays`
- [x] `benchmarks/prompt-injection` extended with same-language-rewrite cases and green — 8 `mode: 'repair'` cases, run as their own arm on the shipping model
- [x] Raw transcript reachable and visibly marked distinct from the normalized line — disclosure per repaired block, labelled "Recognized:"
- [x] Version-coupling decision recorded and implemented — opt-in `repairDisplay`, following `embedSpeaker`

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
