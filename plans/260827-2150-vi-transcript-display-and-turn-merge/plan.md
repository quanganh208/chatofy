---
title: 'Vietnamese transcript display and turn merge'
description: 'Repair the displayed Vietnamese transcript (punctuation, casing, ITN) off the audio critical path, and merge ceiling-cut turns for display. Raw engine output stays canonical.'
status: in-progress
priority: P1
effort: '~6d (P1 cancelled)'
tags: [stt, translate, web, benchmark, thesis]
created: 2026-08-27
blockedBy: []
blocks: []
supersededBy: ['260829-2039-vi-display-itn-and-gemma-removal#phase-04']
---

# Vietnamese transcript display and turn merge

## Overview

Reading a Vietnamese news paragraph into `/translate` produced two turns, an
all-lowercase unpunctuated transcript with spelled-out numbers, and a speaker
prompt on each. The English translation beside it was already correct.

Diagnosis is complete and recorded in
`plans/reports/brainstorm-260827-2125-stt-vi-display-and-segmentation.md`
(best-of-5 verifier pass, winner cand-5). The short version: **the content
survives the recognizer; only its Vietnamese rendering is missing.** Gemini's
prompt rule 4 already repairs machine-transcript artifacts, which is why the
English says "5:00 PM" while the Vietnamese beside it says "mười bảy giờ".

This plan fixes the rendering and the display grouping. It does **not** touch
the recognizer, the VAD constants, or the audio path.

### Two measured facts that shape every phase

1. **The split is the 8s ceiling.** Driving the repo's real `SpeechGate` with a
   trace matching the report: shipped config → 2 turns, first closing `forced`;
   ceiling removed or raised → 1 turn. A mid-sentence pause must reach 500ms to
   split, and read-aloud commas (180–300ms) never do. The cut lands **mid-word**
   at 8.0s of turn time, not at a comma.
2. **The benchmark can never score this fix.** 0/50 VIVOS reference texts contain
   a digit or punctuation, and `text_normalize.py` states outright that "numbers
   are left as written". A correct `17:00` scored against `MƯỜI BẢY GIỜ` counts
   as three substitutions — piping repaired text into the benchmark would make
   the headline 5.38% WER _worse_ while the display got better.

### Corrections to the accepted contract, carried here deliberately

- The contract said the repair could "stream after the English clause so TTS
  start is untouched". **False of this code**, and unfixable: the provider buffers
  the whole stream, `translation-session.service.ts:336` gates clause-splitting on
  the complete result, and — decisively — three turns in four reuse a speculation
  (`translation-model-policy.ts:69`), which no early-forward callback can serve
  without speaking discarded guesses. Phase 4 takes a separate request on a
  separately-metered bucket instead; Phase 1 was cancelled unrun.
- The contract said "requests-per-turn must stay at 1". **False today.**
  `turn-speculation.ts` already speculates, capped at `MAX_SPECULATIONS_PER_TURN = 4`;
  the recorded measurement is 59 requests / 32 turns ≈ 1.84/turn. Restated below
  as a latency-and-RPM constraint, which is what it was actually protecting.

## Goals

| #   | Goal                                                                                                         | Priority |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | Displayed Vietnamese reads as written Vietnamese: `17:00`, `0,4 m`, `Phạm Văn Bạch`, commas, terminal period | P1       |
| 2   | Zero added latency to first translated audio                                                                 | P1       |
| 3   | One utterance renders as one block with one speaker prompt, however many translation turns it was cut into   | P1       |
| 4   | Raw engine output stays canonical, visible, and the only input to WER and latency metrics                    | P1       |
| 5   | Origin of the lost head ("Ghi nhận lúc") settled: capture chain or recognizer                                | P2       |
| 6   | Beam search + hotword biasing measured, whatever it shows                                                    | P3       |

## Phases

| #   | Phase                                                                                                   | Status                      |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | [Phase 1: Stream-shape gate](./phase-01-start.md)                                                       | **Cancelled**               |
| 2   | [Phase 2: Display-fidelity set and zero baseline](./phase-02-display-fidelity-set-and-zero-baseline.md) | **Completed**               |
| 3   | [Phase 3: Offline capture-vs-model diff](./phase-03-offline-capture-vs-model-diff.md)                   | Pending                     |
| 4   | [Phase 4: Vietnamese display repair](./phase-04-vietnamese-display-repair.md)                           | **Superseded (2026-08-29)** |
| 5   | [Phase 5: Display-only turn merge](./phase-05-display-only-turn-merge.md)                               | **Completed**               |
| 6   | [Phase 6: Decoder comparison run](./phase-06-decoder-comparison-run.md)                                 | **Completed**               |

> **Phase 4 is SUPERSEDED, 2026-08-29, and its code is deleted.** Its LLM display
> repair worked and was measured (numerals 0.8810, punctuation F1 0.7222,
> proper-noun caps 0.8636, 0 hallucinations) but landed a median 25.1s — minimum
> 10.0s, never once inside 10 — after the line was already on screen, which the
> user rejected. Replaced by
> [`plans/260829-2039-vi-display-itn-and-gemma-removal/`](../260829-2039-vi-display-itn-and-gemma-removal/plan.md),
> which produces the digits deterministically in process before the line paints:
> **recall 1.0000 against this phase's 0.8810, 0 hallucinations, and 0.21 ms p95
> instead of 25.1 s.** `gemma-4-31b-it` left the system with it.
>
> **What that cost, recorded because this phase is where the number came from:**
> punctuation F1 and proper-noun capitalization both go to **0.0000**. The ITN
> typesets numerals and nothing else, so the casing and punctuation this phase
> earned are gone. That was the accepted trade, not an oversight.
>
> Phase 4's text below stays exactly as written. It is the record of a measured
> design rejected for LATENCY, not for correctness, and a thesis is better for
> keeping it. `benchmarks/stt/data/display-repaired.jsonl` — its output, and the
> evidence behind every number quoted here — is protected and still scoreable,
> though its producer is deleted and it can no longer be regenerated.

**Dependencies.**

- **Phase 1 is CANCELLED** — red-team showed early-forwarding cannot serve the
  dominant path, so its measurement governs at most 25% of turns. Quota unspent.
- Phase 4 consumes Phase 2's baseline and **must land after Phase 5** — both modify
  `apps/web/src/components/translate/conversation-transcript.tsx`, so they are
  logically independent but NOT parallel-safe. Ship 5 first; 4 rebases.
- **Phase 6 is DONE, run ahead of both soft predecessors.** Phase 3's verdict was
  unavailable (it needs a live reproduction) and Phase 2's proper nouns did not
  exist, so its hotword list came from the VIVOS references instead and is
  labelled a ceiling. Result: beam search buys nothing (WER unchanged at 5.38);
  the oracle hotword arm buys 0.72 pt. Nothing promoted — the engine stays greedy,
  now with evidence. `plans/reports/decoder-260828-1000-vi-decoder-comparison.md`.
- **Phase 2 is DONE (2026-08-28).** Metric module, tests, README, 22-utterance
  corpus recorded through the browser capture chain, and the baseline: **0.0000
  on all three metrics**, with 0 numeral hallucinations. Two numeral-free
  sentences are recognized at **0.00% WER and still score zero on display** —
  recognition and display are orthogonal, which is the whole plan in one line.
  Phase 4 is now unblocked on both its predecessors.
- **Phase 4 is DONE (2026-08-28).** One fire-and-forget request per finished turn
  on `gemma-4-31b-it`, gated by an ITN-masked divergence guard, rendered as a
  repaired line with the recognizer's own words one tap beneath it. Scored on the
  Phase 2 corpus: numerals **0.8810**, punctuation F1 **0.7222**, proper-noun caps
  **0.8636**, **0** hallucinations — all three gates cleared from a recorded zero.
  Two of 22 repairs were refused by the guard and fell back to raw, which is the
  design working rather than a shortfall.
  Two corrections to this plan's own assumptions, both measured: the repair takes
  a median of **25.1s** (not ~6.9s), and it needs a concurrency ceiling of its
  own because it outlives its turn by ~25×.
- **Critical path: Phase 2 → Phase 4, and Phase 5 → Phase 4.** Phase 5 is the
  shortest route to visible value: it ships alone, needs no API calls, and fixes
  the reported split by itself. Phase 5 shipped, then shipped a mis-calibrated
  threshold; corrected 2026-08-28 against measured gaps (`f2e31b3`).

### Real-voice evidence, 2026-08-28

`plans/reports/capture-260828-1114-real-voice-capture-chain-vs-recognizer.md`.
Three recordings of one sentence, one speaker, shipping config, only the capture
chain varying: **17.0% WER on a messaging-app chain, 4.3% on an iPhone one.** The
best take beats the 5.38% VIVOS headline on unseen real speech.

Two independent measurements now agree that the recognizer is not where the
remaining Vietnamese quality lives — Phase 6's null decoder result on clean
audio, and a 4x chain effect on real audio. It raises the value of Phase 3 and
leaves Phase 4's case untouched: display scored 0/0/0 on all three takes
regardless of audio quality. It does **not** close Phase 3, which asks about the
_browser_ chain; neither recording went through a browser.

## Constraints

- **Latency is the product.** p50 1163ms / p95 2983ms over 32 turns; p95 already
  misses its 1.8s target. Nothing may be added to the pre-first-audio path.
- **No additional latency-critical or flash-RPM-competing request.** (Restated
  from the contract's incorrect "requests-per-turn = 1".) The per-minute ceiling
  is what a live conversation hits; a repair request contending for the same
  flash bucket as translate + speculation causes 429s that push live turns down
  the ladder toward the 6.9s Gemma model.
- **Local-first covers STT and TTS, not MT.** MT is already cloud. Work riding
  the existing MT call does not weaken the claim, but must degrade to the local
  output rather than to nothing.
- **Zipformer-30M is CC-BY-NC-ND-4.0**, academic only. No engine work here.
- **Thesis integrity.** Repaired text must never reach the benchmark or the
  metrics. The WER table measures the raw engine and must stay unaffected.

## Non-goals

- Diarization / automatic speaker labels. Measured at 23.0% EER against a 10%
  bar and KILLed; `TAU_SUGGEST` ships disabled.
- Any engine swap. PhoWhisper fails the RTF gate (0.332 > 0.3) and — measured in
  `benchmarks/stt/results/r1/` — is all-lowercase on 50/50 with zero digits, so
  it would fix punctuation only. Nemotron is 5.5 pts worse WER.
- Changing `SPEECH_HANGOVER_MS`, `PRE_ROLL_MS`, or `MAX_UTTERANCE_MS`. The
  ceiling stays; Phase 5 fixes the visible harm without paying its latency price.
- A local punctuation-restoration model (option A2). Parked as the fallback if
  Phase 1 fails and the cloud route is rejected.
- Reworking the translation prompt's behavior. Rule 5 (never continue a cut
  fragment) is load-bearing and stays.
- Changing the benchmark's WER normalization. Phase 2 adds a metric; it does not
  alter the one every recorded comparison used.

## Success Criteria

> **Every Phase 4 criterion below was met, and four of them no longer describe
> the shipping system** (2026-08-29). They are left ticked and unedited because
> they were true when measured; what replaced them is recorded in
> `260829-2039-vi-display-itn-and-gemma-removal/phase-05-verify-and-publish.md`.
> Specifically: punctuation F1 and proper-noun capitalization are now **0.0000**,
> not 0.7222 / 0.8636 — the ITN typesets numerals and nothing else; the Gemma
> reserve is gone, so "pinned to the Gemma reserve" is now "no model at all"; the
> same-language prompt-injection cases were REMOVED, because the surface they
> measured no longer exists; and the raw transcript is still reachable in the UI,
> but only on turns the ITN actually changed.

- [x] Reproduction passage renders `17:00`, `0,4 m`, `30 phút`, `Phạm Văn Bạch`, commas and a terminal period — that passage is corpus row `vi-display-01`, repaired to `Ghi nhận lúc 17:00, mực nước trên đường Phạm Văn Bạch dâng 0,4 mét, giao thông tê liệt gần 30 phút.`
- [x] Reproduction passage renders as ONE Vietnamese block with ONE speaker prompt — Phase 5, re-verified by the transcript component's grouping spec
- [x] Display-fidelity set scored without `normalize_text`: numerals ≥0.85, punctuation F1 ≥0.70, proper-noun capitalization ≥0.80, against a recorded ≈0 baseline — 0.8810 / 0.7222 / 0.8636 against 0/0/0
- [x] e2e p50 unchanged within noise — the repair adds no flash traffic and has no mechanism to move it
- [x] Zero added flash-bucket requests or output tokens per turn — pinned to the Gemma reserve, asserted by test
- [x] Repair never issued for a speculation
- [x] Test proves display falls back to raw on MT failure, garbled field, or ladder fallback — never blank, never partial
- [x] Raw transcript reachable in the UI and visibly marked distinct from the normalized line
- [x] `benchmarks/prompt-injection` EXTENDED with same-language-rewrite cases and green — re-running the old translation-direction corpus proves little about the new surface
- [x] `segment.sourceText` carries RAW text; repaired text never reaches the benchmark or the metrics

## Open questions

1. Should saydi.ai's automatic "Speaker 01" be addressed in the thesis
   comparison chapter at all, given the measured KILL? Product/writing call.
2. Which of the three pending UI plans touching `conversation-transcript.tsx`
   are in flight? Confirm before Phase 5 starts, or its 2d becomes a rebase.

## Decisions taken (user, 2026-08-27)

- **Display-fidelity set: the user's own voice, recorded through the real browser
  capture chain.** Same AGC, noise suppression and mic distance the product uses,
  so the numbers describe the real channel. Accepted cost: not publishable as a
  corpus — the thesis cites it as an internal set and states the caveat. This is
  the `TAU_SUGGEST` lesson applied deliberately: that threshold was calibrated on
  clips that never passed through browser processing and ships disabled as a
  result.
- **Phase 1 quota approved (~40 Gemini requests) — then NOT SPENT.** The gate was
  cancelled when red-team showed the design it tested could not serve 75% of turns.
- **Display repair routed to a separate fire-and-forget request on `gemma-4-31b-it`**
  (user, after red-team). Separately metered, so zero contention with the
  latency-critical flash path. Accepted cost: polish lands several seconds after the
  turn rather than ~1s. This deleted six blockers.
- Earlier, at brainstorm: LLM-repaired display accepted (labelled, raw one toggle
  away); segmentation handled as a display-only merge with the 8s ceiling left in
  place.

<!-- slug: vi-transcript-display-and-turn-merge -->
