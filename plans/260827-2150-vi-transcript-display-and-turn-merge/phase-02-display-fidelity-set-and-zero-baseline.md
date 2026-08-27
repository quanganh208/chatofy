---
phase: 2
title: 'Display-fidelity set and zero baseline'
status: pending
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
- [ ] Three metrics implemented, unit-tested, and scored WITHOUT `normalize_text`
- [ ] `không phải` negation corruption case tested and passing
- [ ] Today's baseline recorded: expected ≈0 numerals, ≈0 punctuation F1, ≈0 proper nouns
- [ ] Existing VIVOS WER path untouched — r1/r2 results still reproduce identically
- [ ] README states plainly why the WER table can never credit this feature

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
