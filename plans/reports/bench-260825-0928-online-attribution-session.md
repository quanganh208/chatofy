# Bench 2 — online attribution, unknown N (Checkpoint 2)

**Date:** 2026-08-25
**Branch:** `bench/speaker-id-latency-gate`
**Ran because:** user redirected after the Checkpoint 1 KILL — "tìm cách tối ưu nhất, đăng ký
giọng chỉ là optional thôi".
**Answer:** enrolment is **not** optional. Without it the design misses the bar; with it, it clears
the bar but needs a calibration fix.

## Why this bench exists at all

Checkpoint 1 compared **turn against turn** and returned 23.0% EER. The product algorithm compares
**turn against an accumulated centroid**. Those are different problems, and the enrolment probe had
just shown the gap between them is large. So the screen was a pessimistic proxy for the actual
mechanism and could have produced a false kill. This measures the mechanism directly.

## What was run

- `speaker_bench/online.py` — the real algorithm: assign / start-new-speaker / leave-undecided,
  centroids accumulate from assigned turns only, `seed()` is the optional-enrolment path. 21 tests,
  mutation-checked 4/4 (dead-zone turn poisoning a centroid, ignored centroid cap, majority-vote
  scoring, new-speaker branch disabled).
- `run_session.py` — meetings of N speakers, 5 turns each, random order, 500 meetings per cell.
- Thresholds calibrated on a **disjoint half of the speakers** (15 calibrate / 15 evaluate).
  Stricter than the temporal split the plan specified.
- **Cold and warm run the same meetings, same turns, same order.** Only difference: warm seeds each
  speaker from 3 earlier clips. Every cold/warm delta is therefore enrolment's value, isolated.

## Gate cell — far-field, 2s turns, 5 speakers, held-out thresholds

| model      | start | accuracy  | coverage | \|ΔN\|   | verdict           |
| ---------- | ----- | --------- | -------- | -------- | ----------------- |
| eres2netv2 | cold  | 73.7%     | 84.0%    | **4.17** | PASS (degenerate) |
| eres2netv2 | warm  | **93.9%** | 70.8%    | 0.66     | FAIL (coverage)   |
| campplus   | cold  | 76.6%     | 75.0%    | 2.81     | FAIL              |
| campplus   | warm  | **93.4%** | 71.4%    | **0.61** | FAIL (coverage)   |

### The plan's acceptance criterion admits a degenerate configuration

The one PASS has **|ΔN| = 4.17**: a 5-person meeting rendered as ~9 speaker labels. It passes
because the criterion is accuracy-over-attributed plus a coverage floor, and **cold buys coverage by
inventing clusters** — a turn below `tau_new` starts a new speaker and counts as attributed. Warm
cannot do that (everyone is already seeded), so its weak turns stay undecided and cost coverage.

The bench exited 0 on that configuration. That is a flaw in the gate, not a result.

A metric neither side can game is accuracy over **all** turns (= accuracy × coverage), which
penalises abstention and proliferation alike:

| far-field N=5   | accuracy over all turns |
| --------------- | ----------------------- |
| campplus cold   | 57.5%                   |
| campplus warm   | **66.7%**               |
| eres2netv2 cold | 61.9%                   |
| eres2netv2 warm | **66.5%**               |

Warm wins on the ungameable metric. **Recommend adding a speaker-count constraint to the
criterion** — but that is the plan's declared acceptance shape, so it is the user's call, not mine.

## Cold does not warm up — it degrades

The hypothesis worth killing was "centroids self-strengthen, so enrolment only buys the opening
minute". Per-turn-position accuracy, far-field N=5, spread policy:

|                     | turns 1-5 | 6-10  | 11-15 | 16-20 | 21-25     |
| ------------------- | --------- | ----- | ----- | ----- | --------- |
| campplus **cold**   | 79.8%     | 76.5% | 75.2% | 75.8% | **75.0%** |
| eres2netv2 **cold** | 82.8%     | 72.6% | 69.3% | 69.7% | **73.3%** |
| campplus **warm**   | 94.6%     | 94.5% | 93.2% | 92.5% | **92.5%** |
| eres2netv2 **warm** | 94.7%     | 94.8% | 93.6% | 93.2% | **93.3%** |

Cold's **best** stretch is its first five turns. Early turns are mostly first-appearances, which
create a cluster and are credited correct by the final mapping; later turns must match an existing
centroid, and errors compound because a wrong turn folded into a centroid corrupts every later
decision it takes part in. Warm is flat throughout.

**So the cold/warm gap is permanent and slightly widening, not a warm-up cost.** The hypothesis is
refuted.

Corroborated independently by `scripts/probe_centroid_growth.py` — EER against a centroid, by
centroid size, far-field:

| centroid turns | eres2netv2 | campplus |
| -------------- | ---------- | -------- |
| 1              | 17.0%      | 17.2%    |
| 2              | 15.7%      | 15.4%    |
| 3              | 15.1%      | 14.7%    |
| 4              | 13.0%      | 13.3%    |
| 5              | 14.0%      | 15.0%    |

Averaging five turns buys ~3 EER points and the tail is non-monotone (noise). It never reaches the
10% bar. **The enrolment probe's 88% did not come from centroid averaging — it came from the
closed set**, i.e. from knowing who is in the room. Enrolment supplies that; self-accumulation does
not, because it must still answer "new person or existing one" — the open-set question, at ~14-15%.

(Pool caveat: this curve's 33 speakers with ≥6 gap-separated clips are not the gate's 76. Its k=1
value of 17.0% is not comparable to the gate's 23.0%; only the shape within the curve is.)

## The coverage failure is calibration, not the algorithm

`scripts/probe_threshold_transfer.py` sweeps the same grid **directly on the evaluation speakers** —
an oracle, quoted only as an upper bound:

| cell                              | best reachable                                          | verdict                  |
| --------------------------------- | ------------------------------------------------------- | ------------------------ |
| campplus far-field N=5 **warm**   | acc 88.4% / cov 80.6% / \|ΔN\| 0.66 (τ 0.425/0.275)     | would PASS               |
| eres2netv2 far-field N=5 **warm** | acc 89.6% / cov 80.1% / \|ΔN\| 0.35 (τ 0.450/0.200)     | would PASS               |
| campplus far-field N=3 **warm**   | acc 92.2% / cov 80.5% / \|ΔN\| 0.08 (τ 0.375/0.175)     | would PASS               |
| campplus far-field N=5 **cold**   | acc 73.7% / cov 88.5% / \|ΔN\| **2.37** (τ 0.400/0.350) | would PASS on the letter |

Threshold pairs reaching the coverage floor **do exist** for warm. The held-out run missed them
because the calibration maximises accuracy subject to coverage ≥ 0.80 _on the calibration speakers_,
landing exactly on the floor — so any transfer loss pushes it under. **Measured threshold
non-stationarity: ~9 coverage points.** Fix is a calibration margin (target ~0.88 to land ≥0.80),
not a change to the algorithm.

Even at its oracle best, cold gives ~7.4 labels for 5 people and one wrong label in four. Warm gives
~5.7 labels and one in nine.

## Channel leakage is worth more here than at Checkpoint 1

Same bench, gap rule removed (`adjacent` policy, 108 speakers instead of 30), far-field N=5:

|                                      | spread (honest) | adjacent (leaky) | inflation |
| ------------------------------------ | --------------- | ---------------- | --------- |
| eres2netv2 cold accuracy             | 73.7%           | 86.0%            | **+12.3** |
| eres2netv2 warm coverage             | 70.8%           | 82.2%            | **+11.4** |
| campplus warm accuracy               | 93.4%           | 98.2%            | +4.8      |
| campplus far-field N=3 warm accuracy | 91.2%           | 98.1%            | +6.9      |

Every leaky cell PASSes. A bench without the gap rule would have declared the whole design good.
This is larger than Checkpoint 1's 5.8 EER points, as expected: self-clustering builds centroids
from a speaker's own earlier turns, so shared-recording similarity feeds directly back into the
mechanism.

## Model choice

campplus and eres2netv2 are within noise of each other on every warm cell (93.4% vs 93.9% at the
gate cell; |ΔN| 0.61 vs 0.66). Phase 5 already decided it: eres2netv2 is MARGINAL at the 2-decode
architectural ceiling (517ms, 28% headroom), campplus keeps 82%. **campplus.**

## What this does not measure

- **No unenrolled speaker ever appears.** Warm seeds everyone present. A guest who skipped
  enrolment is the untested case and remains the largest open risk.
- **No browser DSP.** Phase 7, still unrun.
- **Simulated far-field**, on already-broadcast-processed audio.
- **30 speakers, 15 evaluated.** Small. Per-speaker variance is not characterised.
- **5 turns per speaker, 2s each.** A real meeting is longer; cold's degradation trend suggests
  longer would be worse, not better, but that is extrapolation.
- **`segment.py` still bypassed.**
- Turn lengths fixed at 2s rather than sampled from a measured histogram, as the plan specifies.

## Unresolved questions

- Does the acceptance criterion get a speaker-count constraint? Without one it passed a
  configuration producing 9 labels for 5 people. Plan-declared criterion, so user's call.
- Guest handling: what happens to someone who did not enrol? Unmeasured.
- Is a calibration margin (target 0.88 for a 0.80 floor) enough, or do thresholds need to adapt per
  session? The ~9-point transfer loss was measured on one split.
- Enrolment budget 3×5s was assumed, never swept.
- Voice templates are biometric data — retention and consent model still undecided.
- VoxVietnam is `cc-by-nc-4.0`; fine for benchmarking, not a basis for shipping anything derived
  from it.
