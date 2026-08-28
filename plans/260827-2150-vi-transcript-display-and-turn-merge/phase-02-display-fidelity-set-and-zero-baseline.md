---
phase: 2
title: 'Display-fidelity set and zero baseline'
status: in-progress
priority: P1
effort: '1d'
dependencies: []
---

# Phase 2: Display-fidelity set and zero baseline

## Overview

Build the measurement that does not exist yet, and record what today's output
scores on it. Without this the fix has no "before" number and the thesis has no
evidence it did anything.

## Why this phase exists — the benchmark is structurally blind

Measured from this repo's own `benchmarks/stt/results/r1/`, 50 vi utterances:

| Source                       | any uppercase  | any punctuation | any digit |
| ---------------------------- | -------------- | --------------- | --------- |
| VIVOS reference (`ref_text`) | 50/50 ALL-CAPS | **0/50**        | **0/50**  |
| sherpa-zipformer-vi          | 50/50          | 0/50            | 0/50      |
| fw-phowhisper-vi             | 0/50           | 50/50           | 0/50      |

And `benchmarks/stt/stt_bench/text_normalize.py` says in its own docstring:
"numbers are left as written — a known WER caveat".

So there is **no label to score against**. This is stronger than the lesson
recorded in `docs/development-journey.md` §8, which blames the WER normalization
alone. A correct `17:00` scored against `MƯỜI BẢY GIỜ` is three substitutions.
**Fixing ITN would make the headline WER worse.**

Consequence, and it is a hard rule for the rest of the plan: repaired text must
never enter the VIVOS pipeline. This phase builds a _separate_ measurement.

## Requirements

- Functional: a held-out set of ≥20 Vietnamese utterances whose references carry
  real digits, punctuation and proper nouns; three metrics scored **without**
  `normalize_text`; today's baseline recorded.
- Non-functional: additive to `benchmarks/stt`. The existing WER path, its
  normalization, and every recorded r1/r2 result stay untouched and comparable.

## Architecture

New manifest + new scorer beside the existing ones, sharing the runner:

- `benchmarks/stt/data/manifest-vi-display.jsonl` — same row shape as
  `manifest-vi.jsonl`, but `ref_text` preserves digits, punctuation and casing.
- A display-fidelity scorer, separate module from `metrics.py`, computing:
  - **numeral-form exact match** — did `17:00` come out as `17:00`
  - **punctuation F1** — placement of `,` and `.` against the reference
  - **proper-noun capitalization accuracy** — over a per-utterance list of the
    proper nouns the reference contains
- `normalize_text` is **not** applied on this path. That is the entire point;
  applying it would erase exactly what is being measured.

## Related Code Files

- Create: `benchmarks/stt/data/manifest-vi-display.jsonl`
- Create: `benchmarks/stt/stt_bench/display_fidelity.py`
- Create: `benchmarks/stt/tests/test_display_fidelity.py`
- Modify: `benchmarks/stt/run_benchmark.py` (opt-in flag for the display set)
- Modify: `benchmarks/stt/README.md` (what the set is, why WER cannot score it)
- Read only: `benchmarks/stt/stt_bench/text_normalize.py`, `metrics.py`, `manifest.py`

## Implementation Steps

1. **Decided:** record in the user's own voice **through the real browser capture
   chain** — same AGC, noise suppression and mic distance the product uses, so the
   numbers describe the channel that actually ships. Not a public corpus. The
   README must state that this is an internal set and that its audio is therefore
   not independently reproducible.
2. Record ≥20 utterances. Must include: a clock time, a decimal
   measurement, a plain quantity, and ≥2 Vietnamese proper nouns. The reported
   flood passage is one of them.
3. Write references by hand with real orthography. This is the ground truth the
   project currently lacks; it is worth doing carefully once.
4. Implement the three metrics with unit tests over hand-built cases — including
   the corruption case `không phải` (a negation) which must **not** be converted
   to a numeral, and `0,4` vs `0.4` decimal-comma handling.
5. Run today's shipping `postprocess()` output against the set. Record the
   baseline. Expect ≈0 on all three.
6. Commit the baseline numbers into the phase record so the "after" has something
   to be compared to.

## Success Criteria

- [ ] ≥20-utterance display set exists with references carrying digits, punctuation, proper nouns
- [x] Three metrics implemented, unit-tested, and scored WITHOUT `normalize_text`
- [x] `không phải` negation corruption case tested and passing
- [ ] Today's baseline recorded: expected ≈0 numerals, ≈0 punctuation F1, ≈0 proper nouns
- [x] Existing VIVOS WER path untouched — r1/r2 results still reproduce identically
- [x] README states plainly why the WER table can never credit this feature

## Progress (2026-08-28): instrument built, corpus still blocked

The measurement instrument landed; the corpus it measures cannot be built
without the user at a microphone, so this phase stays open.

**Done.** `benchmarks/stt/stt_bench/display_fidelity.py` — numeral recall,
punctuation F1, proper-noun capitalization, all on the raw string with
`normalize_text` deliberately not applied. 24 tests in
`tests/test_display_fidelity.py`; full bench suite 46 passed. README section
added. The VIVOS path is untouched: no existing module changed, and re-rendering
the report still gives 5.38 / 2.90 for `sherpa-zipformer-vi`, so r1/r2 hold by
check as well as by construction.

The tests were mutation-tested rather than trusted. A first review pass ran 40
mutants and found 13 real survivors — the F1 formula itself was unpinned (an
arithmetic mean passed every test), mark identity was unpinned (keying every mark
as a comma passed every test), and four tests scored a string against _itself_,
where recall is 1.0 for any tokenizer at all. All are now killed by a named test.
Two behaviors were corrected as a result: a run of the same mark counts once
(`...` is one ellipsis, and triple-counting scored a correct terminal mark at F1
0.5), and `__add__` iterates `dataclasses.fields` so a `ClassVar` added later
cannot raise.

Three design decisions the phase left open, settled while implementing:

- **Punctuation F1 anchors each mark to its preceding word.** Counting marks
  would score a hypothesis with the right number of commas in the wrong clauses
  as perfect. Anchoring makes it placement, which is the property worth having.
- **A Vietnamese decimal comma is part of the number, not a clause boundary.**
  `0,4` contributes one numeral and zero punctuation. The numeral pattern
  consumes separators that sit between digits, which is what keeps `2/9/1945`
  and `17:00` single tokens too.
- **Capitalization accuracy is scored only over nouns the recognizer actually
  produced**, with coverage reported beside it. Scoring casing over words that
  were never recognized would punish one acoustic miss twice and make this
  metric drift with audio quality — the opposite of its purpose.

Added beyond the three metrics, and required by this phase's own `không phải`
criterion: a **numeral-hallucination count**. Without it that test has nothing to
assert — recall alone cannot see a digit invented where the reference had none.

**Recording instrument ready.** `record-display-set.html` in this plan directory:
22 sentences, recorded through the app's own capture path rather than a generic
recorder. It reuses `CONVERSATION_AUDIO` verbatim, and — the part that matters —
does NOT go through `MediaRecorder`. `/translate` sends raw PCM16 at 16 kHz over
the socket and never encodes Opus, so a MediaRecorder capture would add a lossy
codec the product does not have. That is precisely the artefact worth 12.7 WER
points between the two chains already measured.

It replays the shipping maths instead: Float32 at the device rate, chunked into
1024-sample blocks, each downsampled independently through a copy of
`downsampleToPcm16` — including the per-block phase reset, which a whole-utterance
resample would quietly smooth away. Verified sample-for-sample against the real
implementation at 48000/44100/16000 Hz, plus a case reconstructing the exact block
sequence `conversation-session.ts` emits. Changing the block size to 512, or
resampling the whole utterance at once, both break that check.

It also reads back `track.getSettings()` and refuses to look healthy if the
browser ignored any of the three constraints — a constraint is a request, not a
guarantee, and a corpus recorded with AGC silently off would describe a channel
nobody ships.

The sentence set carries what the phase requires: clock times, decimal
measurements with the Vietnamese comma, plain quantities, thousands separators,
and 15 proper nouns across 12 sentences. Three sentences carry the `không phải`
negation so the ITN corruption case has real audio behind it. Sentence 01 is the
reported flood passage, deliberately over the 8s ceiling so it exercises the
Phase 5 merge at the same time.

**Blocked.** Steps 1–3 and 5 need the user's voice through the real browser
capture chain (the recorded decision). No corpus, so no ≥20-utterance set and no
corpus baseline.

**Partial baseline, on real speech.** Three takes of one sentence, one speaker
(`plans/reports/capture-260828-1114-real-voice-capture-chain-vs-recognizer.md`)
score **0 digits, 0 punctuation marks, 0 correctly-cased proper nouns** — on all
three, including the take that reached 4.3% WER. The ≈0 prediction holds and is
independent of audio quality. It is a seed, not the set: n=1 sentence, and the
recordings did not pass through a browser.

That report also carries the phase's strongest argument, now measured rather than
argued from VIVOS: the same take scores 4.3% WER against a spoken reference and
26.8% against the written form, the whole 9-error gap being one date. Score the
spoken reference verbatim against the written one — a recognizer that makes no
mistakes at all — and it still lands at **22.0%**. **A perfect recognizer fails
written Vietnamese.**

## Risk Assessment

- **The set flatters the system.** Resolved by decision: recording goes through
  the real browser capture chain, not a clean close-mic corpus — the trap that left
  `TAU_SUGGEST` uncalibrated and disabled. Residual signal to watch: display
  metrics still far better in the harness than in a live reproduction, which would
  mean the recording setup drifted from the product's. Response: re-record through
  the app's own capture path, not a separate recorder.
- **Hand-written references encode one person's orthographic preferences**
  (`0,4` vs `0.4`, `17:00` vs `17 giờ`). Signal: disagreement about whether an
  output is correct. Response: write the convention down in the README as part of
  the ground truth, not as a scoring detail.
- **Twenty utterances is a thin sample.** Signal: metric moves more between runs
  than between conditions. Response: report the count beside every number and do
  not claim precision the sample cannot carry.
