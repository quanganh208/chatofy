---
title: 'Speaker-id Phase 5: latency and contention ceiling'
date: 2026-08-24
summary: 'Measured embedding cost in the prod container at 1 and 2 concurrent STT decodes. eres2netv2 breaks at the architectural ceiling; campplus and wespeaker_en keep >80% headroom.'
---

# Speaker-id Phase 5: latency and contention ceiling

Measured embedding cost in the prod container at 1 and 2 concurrent STT decodes. eres2netv2 breaks at the architectural ceiling; campplus and wespeaker_en keep >80% headroom.

## What was measured

`benchmarks/speaker-id/run_latency.py`, inside `chatofy_prod-local-stt` with production's thread
environment passed explicitly. REPS=50, 3 warm-ups discarded, p95 by nearest rank. Two runs: one
concurrent STT decode, then two — which is the architectural maximum, since
`services/local-stt/engines/registry.py` registers exactly two engines (vi, en) each holding its own
lock across a decode.

Gate cells (extractor num_threads=2, turns <=3s, 723ms Gemini window):

| Model        | idle    | 1 decode | 2 decodes                        |
| ------------ | ------- | -------- | -------------------------------- |
| campplus     | 24.9ms  | 35.3ms   | 132.2ms                          |
| eres2netv2   | 160.1ms | 268.2ms  | 517.0ms (28% headroom, MARGINAL) |
| wespeaker_en | 25.6ms  | 40.7ms   | 136.6ms                          |

## What it cost to get an honest number

Four things went wrong before the numbers meant anything, and all four were self-inflicted:

- **Quoted host numbers as the headline** while the plan declares the container run authoritative.
  They diverged 57% on one contended cell.
- **`best = min(...)` ranged over durations as well as thread counts**, so the "recommended"
  configuration was whichever cell happened to be fastest — it named the losing config. Fixed by
  comparing at a fixed 3s.
- **p95 at REPS=12 was the second-largest sample (~87th percentile), not the 95th.** That single
  estimator error produced the "MARGINAL, 11% headroom" finding I reported as a genuine risk. At
  REPS=50 with nearest-rank the same cell reads 37% headroom. The concern was an artifact.
- **An INCOMPLETE run exited 0**, so an idle-only artifact would have read as a pass. Now exits 3.

Mutation testing caught what the passing suite did not: 4 of 5 injected mutants initially survived.
Extracting `classify()` / `fits_window()` and anchoring the gate-line matcher took it to 5/5 killed.

## The result that matters

Acceptance criterion 5 ("if delta≈0 does not hold contended, state the ceiling at which it breaks")
was recorded NOT MET by review, and closing it changed a conclusion rather than confirming one. At
one decode all three candidates fit comfortably and the model choice looked like a free pick on
accuracy alone. At the real ceiling **eres2netv2 stops fitting** — 28% headroom at production's
LOCAL_STT_THREADS=4, and over the window entirely at dev's 8.

The pre-registered rule (campplus default unless eres2netv2 clears >=20% relative EER on the
far-field 2s bucket) was written before any of this existed, deliberately, so it could not be
rationalised afterwards. It now has a cost side with hard numbers on it.

Also learned: at the ceiling the best `num_threads` scrambles per cell, because with 8 of 16 logical
cores held by STT the between-thread spread drops below run-to-run noise. So `num_threads` should be
stated as "1-2, and do not tune it against a contended measurement" rather than as an optimum.

## Still blocked

Phases 1, 3, 4, 6 wait on the fixture recording, which needs the user. Phase 5 ran ahead precisely
because it depends only on Phase 2.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
