---
phase: 5
title: 'Live verification and published record'
status: complete — except A13b
priority: P1
effort: '0.5d'
dependencies: [1, 4]
---

## Result — 2026-08-29

### The numbers, including the two that got worse

| metric                                  | LLM, old refs                      | LLM, D1 refs | **ITN**                                  | verdict                                     |
| --------------------------------------- | ---------------------------------- | ------------ | ---------------------------------------- | ------------------------------------------- |
| numeral recall (in-sample)              | 0.8810                             | 0.8571       | **1.0000** (42/42)                       | A1 — bar was `max(0.8571, 0.8810)` = 0.8810 |
| numeral hallucinations (in-sample)      | 0                                  | 1            | **0**                                    | —                                           |
| **numeral hallucinations, held-out vi** | —                                  | —            | **0**                                    | **A2 — met**                                |
| **numeral hallucinations, held-out en** | —                                  | —            | **0**                                    | **A16 — met**                               |
| held-out round-trip recall              | —                                  | —            | **vi 1.0000 (51/51), en 1.0000 (21/21)** | A1 held-out                                 |
| punctuation F1                          | 0.7222                             | 0.8333       | **0.0000**                               | **A10 — worse, on purpose**                 |
| proper-noun capitalization              | 0.8636                             | 0.8636       | **0.0000**                               | **A10 — worse, on purpose**                 |
| VIVOS WER                               | 5.38%                              | —            | **5.38%** (CER 2.90%)                    | A9 — unchanged, re-measured                 |
| added latency per turn                  | 25.1s median, 92.6s max, 10.0s min | —            | **0.21 ms p95**                          | A7                                          |
| `en_to_vi` display                      | typeset by the LLM                 | —            | **typeset by the English ITN**           | A14                                         |

**On the latency figure.** 0.21 ms is the p95 over the 22-utterance batch on an
idle machine, reproduced three times (0.215 / 0.223 / 0.211). The same script
read 4.09 ms while the full jest suite was running on the same box — a caveat
this benchmark's README already states in general and which applies here: 22
samples is a small sample and this number moves with machine load. The
independent check is the spec's own micro-benchmark, 200 iterations asserting
p95 < 5 ms, which passes either way. Against a 25.1-second median the distinction
does not change any conclusion, but the measured number should not be quoted
tighter than it is.

`Phạm Văn Bạch` now displays as `phạm văn bạch`. That is the accepted cost, and
it is in the headline table rather than a footnote because A10 was the condition
the design was accepted under.

### Evidence tiers, labelled — never merged

1. **in-sample** — 22 utterances, one speaker, and the ITN was written while
   reading them. Feasibility, not an estimate.
2. **held-out text** — 100 negative utterances (50 VIVOS + 50 LibriSpeech) for
   A2/A16; 70 round-trip sentences for recall. **Contains no ASR errors**: it
   measures the grammar, not the pipeline.
3. **live** — the real stack, below.

**English has only tiers 2 and 3.** No English display-fidelity corpus exists and
the 50 held-out moonshine utterances carry zero digits, so English has **no
in-sample spoken recall figure at all**. Weakest evidence in the plan.

### A13 — live verification on the real stack

Ran a dev stack (postgres + local-stt + local-tts in Docker, API on the host)
alongside the user's running production stack without touching it, and drove
**three real turns** through the real WebSocket gateway with real corpus audio —
real recognizer, real ITN, real transport. Everything started was stopped
afterwards; production stayed up throughout.

| utterance                                  | `segment.sourceText` (raw)                                                                    | `display` on the SAME event                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `vi-display-06` (a time **and** a date)    | `Cuộc họp rời sang mười bốn giờ ba mươi phút ngày mười hai tháng mười tại phòng họp tầng bảy` | `Cuộc họp rời sang 14:30 ngày 12/10 tại phòng họp tầng 7` |
| `vi-display-02` (date with a year)         | `Ngày mùng hai tháng chín năm một chín bốn năm tại quảng trường ba đình ...`                  | `Ngày mùng 02/09/1945 tại quảng trường ba đình ...`       |
| `vi-display-04` (no numerals, has `không`) | `Tôi không phải người hà nội tôi sinh ra ở đà nẵng`                                           | **field absent**                                          |

Every run: **1** `server.transcript.final`, **0** `server.transcript.display`,
audio frames delivered, turn closed normally. Three properties proven on real
audio rather than in a fixture:

- the digits ride on the transcript event, so there is no second frame to flash;
- `ba đình` (a proper noun) and `không phải` (a negation) were **not** digitized;
- a numeral-free turn carries **no `display` key at all**, so no "show original"
  disclosure appears under it.

### A13b — NOT closed, and not claimable

**What is missing is the browser, and it is the half that needs a person.** Two
things remain unverified:

1. **The single-commit paint.** D10 makes it structural — one event, one reducer
   update, asserted in `turn-keyed-transcript.spec.ts` — but "no words-form
   flash" is a visual fact about a real React render, and a still screenshot
   cannot distinguish one paint from two. It needs a screen recording or a commit
   counter, in a browser.
2. **What the live partial line showed.** All three runs recorded **0**
   `server.transcript.partial` events, because frames were pushed far faster than
   real time. So this run cannot say what the reader sees mid-utterance — which is
   exactly what D8 requires be written down.

From source, the live line renders raw decoder text (`live-preview.ts:66-73`,
rendered and then deleted on `final` at `turn-keyed-transcript.ts:378`,
`:421-427`), so a reader **does** watch words become digits at the finalization
boundary on every numeral-bearing turn. Goal 1 is scoped to the finished line for
that reason. **That is read from code, not observed**, and the difference is
stated here rather than smoothed over.

**To close it:** `pnpm dev`, sign in, speak one sentence with a date and a time,
and record the screen. Roughly an hour, and the only remaining item in the plan.

### A12 — runs with no key; CI wired, with one honest limit

The whole ITN sequence runs green with `GEMINI_API_KEY` unset. A `display-fidelity`
job now runs the three held-out gates on every push.

**The 22-utterance scoring cannot run in CI and never will**, because its audio
and manifest are one speaker's personal data and are gitignored. What CI runs is
the held-out half — negatives in both languages and round-trip recall — whose
inputs are now committed under three explicit `.gitignore` exceptions. That is
the durable regression gate; the in-sample score stays a local measurement.

# Phase 5: Live verification and published record

## Overview

Run the system for real, publish every number including the two that got worse,
and close out the plan this one supersedes.

## A13 — the one manual browser run

**The render path has never been exercised end-to-end in a real browser.** That is
phase-04's own stated limitation — it shipped on component and reducer tests only
— and it is the largest untested surface in either design.

This phase closes it, once, by hand: start the stack, speak or replay one utterance
containing a date and a time, and watch the **finished-turn** Vietnamese line paint
with digits already in it and never change afterwards. Screenshot into the record.

**Record what the LIVE line showed, too — this is not optional (D8).** While the
speaker talks, `live-preview.ts:66-73` emits `server.transcript.partial` carrying
raw decoder text, ungated (`translation-session.service.ts:205` fires on every
audio frame; `turn-session.ts:36` constructs the scheduler per turn
unconditionally). The reducer renders it as the italic live line and deletes it on
`final` (`turn-keyed-transcript.ts:378`, `:421-427`). So the reader **does** watch
Vietnamese words become digits at the finalization boundary, on every turn
containing numerals.

Goal 1 is therefore scoped to the finished line (D8), and this phase must write
down what the live line showed so the thesis does not claim a property the product
does not have. The alternative — running the ITN on partials — was rejected:
spans complete mid-utterance, so digits would churn as the line grows, which is its
own version of the objection this plan exists to answer.

**Verify a SINGLE commit, not just "digits present".** D10 moved the display onto
`server.transcript.final` precisely so there is one frame and one commit; this run
is what proves it worked. A still screenshot cannot distinguish one paint from two
— use a screen recording or a React commit counter, and record which was used. If a
words-form flash is still visible, D10 did not take effect and the two-event path is
still live somewhere.

Not Playwright infrastructure. One verified run, an hour. It is the only point in
the plan where Q5 stops being an untested surface.

## The numbers to publish, including the bad ones

| metric                                     | LLM, old refs      | LLM, D1 refs   | ITN                                    | verdict                                             |
| ------------------------------------------ | ------------------ | -------------- | -------------------------------------- | --------------------------------------------------- |
| numeral recall                             | 0.8810             | _from Phase 1_ | _fill_                                 | A1, bar = **max(both LLM columns' higher, 0.8810)** |
| en_to_vi display                           | typeset by the LLM | —              | _fill: English ITN_                    | A14                                                 |
| EN hallucinations (held-out, 50 moonshine) | —                  | —              | _fill_                                 | **A16 — must be 0**                                 |
| EN recall                                  | not measured       | —              | _fill from the EN round-trip set only_ | no in-sample EN figure exists                       |
| numeral hallucinations                     | 0                  | _from Phase 1_ | _fill_                                 | **A2 — must be 0**                                  |
| punctuation F1                             | 0.7222             | _from Phase 1_ | **expected 0.0000**                    | A10                                                 |
| proper-noun capitalization                 | 0.8636             | _from Phase 1_ | **expected 0.0000**                    | A10                                                 |
| VIVOS WER                                  | 5.38%              | —              | _fill_                                 | A9, must be unchanged                               |
| added latency per turn                     | 10.0-92.6 s        | —              | _fill, expect < 5 ms_                  | A7                                                  |

Both LLM columns are published side by side, per the Phase 1 decision, so no reader
can suspect mixed conventions.

**A10 is a criterion, not a footnote.** Punctuation and proper-noun capitalization
go to zero. `Phạm Văn Bạch` becomes `phạm văn bạch`. Sentence-initial capitals
survive, because `zipformer_vi.py::postprocess()` already produces them.

**Label the evidence tiers, do not merge them.** Three different strengths of claim:

1. **in-sample** — the 22-utterance corpus (feasibility)
2. **held-out text** — tier 2 negative corpus for A2, tier 3 round-trip for A1
   (function correctness; tier 3 contains no ASR errors, say so)
3. **live** — the single browser session above (integration)

Vietnamese has all three. **English has only tiers 2 and 3** — no spoken in-sample
set exists. Say so.

Writing "validated on held-out data" without splitting these overstates the
plan's weakest point.

## Related Code Files

- Modify: this file (results, screenshot)
- Modify: `plans/260827-2150-vi-transcript-display-and-turn-merge/plan.md` and
  `phase-04-vietnamese-display-repair.md` — mark Superseded, **do not delete**
- Modify: `docs/development-journey.md` — new dated entry with the real numbers
- Read only: `benchmarks/stt/data/display-repaired.jsonl`

## Implementation Steps

1. Run the ITN scoring sequence with **no API key set**, proving A12.
2. Re-run `benchmarks/stt/run_benchmark.py` on the vi set for A9. Cheap insurance —
   the ITN never touches `sourceText`, so this is a smoke test.
3. Wire the ITN scorer step into CI. The old step 2 could never run there because it
   spent real quota; this one can.
4. One manual browser session; screenshot; record what was spoken and what painted.
5. Fill the table. **If A2 is not 0, stop** — return to Phase 2. Do not publish
   plan-complete with a non-zero hallucination count.
6. Mark phase-04 of `260827-2150` Superseded with a one-line reason and a link here.
   Keep its text: a measured design that worked and was rejected for latency is
   worth keeping in a thesis.
7. Reconcile that plan's phases table and Success Criteria, which currently claim
   display-repair criteria this plan reverses.
8. Answer or re-raise the open questions.

## Success Criteria

- [x] **A2 = 0, labelled held-out, linked to the Phase 2 review notes**
- [x] A1 recorded against the `max(re-baselined LLM, 0.8810)` bar, labelled in-sample, with the tier-3
      held-out figure beside it
- [x] A9 — VIVOS WER unchanged at 5.38%
- [x] A10 — punctuation F1 and proper-noun capitalization published as numbers
- [x] A12 — sequence runs with no API key; CI step added
- [x] A13 — **server half done live** on three real turns through the real
      WebSocket with real audio: the finished line carries its digits on the
      transcript event, `transcript.display` count 0. The **browser render** half
      is A13b below and is not done.
- [ ] **A13b — NOT DONE.** Needs a browser and a person: no `transcript.partial`
      was observed (frames were pushed faster than real time), and a single-commit
      paint cannot be proven without a screen recording or a commit counter. The
      live line's content is known from source, not from observation — said so in
      the Result rather than smoothed over.
- [x] `260827-2150` phase-04 marked Superseded; its plan.md reconciled
- [x] `docs/development-journey.md` has a dated entry with the real numbers

## Risk Assessment

**The temptation this phase exists to resist: publishing the good numbers and
soft-pedalling the two bad ones.** A10 was the condition the design was accepted
under. Reporting A1/A2 green while burying F1 -> 0 makes the whole plan dishonest.

**Signal it broke:** the write-up describes the change as an improvement without a
sentence naming what got worse. **Response:** rewrite it.

**Second risk: the browser run finds something.** It is the first real execution of
this path; a defect here is likely and is the phase working. Budget for it rather
than treating it as a scheduling surprise.

## Open questions

1. **English has no in-sample spoken recall figure at all** — there is no English
   display-fidelity corpus, and the 50 held-out moonshine utterances carry 0 digits.
   English recall rests on the round-trip text set alone. Record that limitation
   explicitly; do not present the Vietnamese evidence structure as if it covered
   both directions.
