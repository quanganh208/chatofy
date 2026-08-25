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

---

# Addendum — 2026-08-25, after the two-mode decision

User chose: two modes with enrolment kept optional, plus a speaker-count constraint added to the
acceptance criterion. Both were implemented and re-measured. Three findings, one of which is a
blocker for the chosen design.

## The criterion now has three parts

`accuracy >= 70%` over attributed turns, `attributed >= 80%`, and `|ΔN| <= 1.0`. The third exists
because the two-part criterion passed a configuration rendering a five-person meeting as ~9 labels.

## Calibration margin, set from measurement

The first run aimed calibration at the floor itself and missed it in transfer. Measured transfer
loss over 48 calibrations: mean +5.1pt, **p90 +13.8pt**, max +19.6pt. Margin set to 14pt (the p90).
Re-measured after the change: mean +3.5pt, p90 +10.4pt — the margin now covers p90 and the run's
self-check stops firing.

Effect on the enrolled mode: attributed rose from ~78-86% to ~91%, and both models went to 3/3
splits passing.

## Gate cell — far-field, 2s, 5 speakers, 3 independent speaker splits

| model      | mode | accuracy                                       | attributed  | \|ΔN\| | splits passing |
| ---------- | ---- | ---------------------------------------------- | ----------- | ------ | -------------- |
| campplus   | warm | 87.1 ± 2.0%                                    | 91.3 ± 2.3% | 0.11   | **3/3**        |
| eres2netv2 | warm | 87.7 ± 2.5%                                    | 91.2 ± 3.9% | 0.17   | **3/3**        |
| eres2netv2 | cold | 73.2 ± 2.1%                                    | 89.2 ± 0.3% | 2.09   | 0/2            |
| campplus   | cold | no acceptable configuration exists on the grid |             |        |

**Enrolled mode PASSES. Unenrolled mode FAILS at 5 speakers, passes at 3** (campplus far-field cold:
78.0% / 93.4% / |ΔN| 0.99, 1/3 splits).

`campplus`, per Phase 5's latency ceiling. Its accuracy is within noise of eres2netv2 everywhere.

### A second bench-honesty fix

When no threshold pair met the constraints, `calibrate()` returned the closest miss and main()
printed its behaviour as a measurement — 12 clusters for a 5-person meeting, formatted like a
result. It now returns `None` and the cell reports "no acceptable configuration". Same underlying
fact; only the second version reads as a conclusion instead of a number.

## The blocker: partial enrolment

The chosen design has three cases, not two — everyone enrolled, nobody enrolled, and **some
enrolled**. The third is the likeliest real meeting and is the worst of the three.

Shipping thresholds, campplus far-field, 4 enrolled + 1 guest:

| outcome for the guest's turns                 | rate      |
| --------------------------------------------- | --------- |
| attributed to an enrolled person (**stolen**) | **67.6%** |
| left undecided                                | 32.0%     |
| given their own cluster (correct)             | 0.4%      |

Theft is the worst outcome available: the guest's words appear under someone else's name AND the
wrong turn is folded into that person's centroid, so it keeps costing.

**It is not a calibration choice.** Holding `tau_assign` at its calibrated 0.350 and sweeping
`tau_new` up to meet it — collapsing the dead zone entirely:

| tau_new              | guest own-cluster | guest stolen | enrolled accuracy | spurious-new |
| -------------------- | ----------------- | ------------ | ----------------- | ------------ |
| 0.150 (shipping)     | 0.6%              | 67.3%        | 86.1%             | 0.0%         |
| 0.250                | 13.8%             | 63.9%        | 84.0%             | 3.0%         |
| 0.350 (no dead zone) | 49.2%             | **50.8%**    | **74.7%**         | 14.7%        |

At maximum openness the guest is still stolen more than half the time, and enrolled accuracy has
fallen 11 points. There is no operating point that serves both.

The cause is consistent with everything measured before it: the embedding cannot separate an
**unknown** Vietnamese speaker from four known ones on a 2s far-field turn. That is the same
open-set weakness Checkpoint 1 measured at 23% EER. Enrolment never fixed it — it removed the
open-set question. A guest puts the question back.

**So enrolment works only when enrolment is complete.**

## Unresolved questions

- Can "somebody unenrolled is speaking" be decided at **session** level instead of per turn?
  Pooling evidence across ~25 turns is a far stronger test than one 2s turn, and nothing here
  measures it. This is the most promising unexplored direction and would decide whether partial
  enrolment is recoverable.
- Should the product refuse to label until everyone has enrolled, rather than degrade?
- Browser DSP (Phase 7) is still unmeasured and sits upstream of every number here.
- 30 speakers, 15 evaluated per split. Small; three splits bound the split-dependence but not the
  corpus-dependence.
- 5 turns per speaker at 2s. Real meetings are longer, and cold's degradation trend suggests longer
  is worse for the unenrolled mode.
- Voice templates are biometric data — retention and consent model still undecided.

## Session-level detection does not rescue partial enrolment either

Per-turn guest handling had no operating point, so the question was moved to the session: not
"is this turn a stranger" but "does this meeting contain somebody who did not enrol", decided once
over ~25 turns instead of once per 2s turn.

Two statistics, matched arms (five speakers and 25 turns in both; the only difference is whether the
fifth person's centroid was seeded):

- **coherence** — do the turns that matched no centroid resemble each other? A guest emits a
  coherent group; scattered leftovers do not.
- **unmatched count** — the baseline: how many turns matched nothing.

| model      | condition | coherence AUC / detection | unmatched-count AUC / detection |
| ---------- | --------- | ------------------------- | ------------------------------- |
| campplus   | far-field | 0.725 / 25.8%             | **0.774 / 36.5%**               |
| eres2netv2 | far-field | 0.718 / 15.5%             | 0.761 / 27.3%                   |
| campplus   | clean     | 0.840 / 44.2%             | 0.850 / 51.5%                   |
| eres2netv2 | clean     | 0.813 / 60.2%             | 0.797 / 31.2%                   |

Detection is quoted at a 5% false-alarm rate. **Best far-field result: 36.5%** — two meetings in
three containing an unenrolled speaker go unnoticed. AUC 0.774 caps it; loosening the false-alarm
rate trades one failure for the other rather than fixing either.

The coherence statistic also loses to simply counting, so that hypothesis is refuted too. Its
premise — that a guest's unmatched turns find each other — requires the guest's turns to be mutually
similar, which is the same 2s self-similarity Checkpoint 1 measured as unreliable. It was the same
weakness wearing a third disguise.

## What the measurements establish, and what they leave to the product

Firm: **with these embeddings, per-turn attribution on Vietnamese 2s far-field audio is reliable
only when every participant has enrolled, and the system cannot detect from audio when that
condition is violated.** Three separate attempts to work around it — self-accumulating centroids,
a re-tuned new-speaker threshold, session-level detection — each failed, and each failed at the
same underlying open-set weakness.

Not a measurement, but the practical consequence: `apps/web` **already knows who is in the room**.
Participants join through the app, so the speaker set is product state, not something to infer from
audio. If enrolment is part of joining, partial enrolment stops being a condition to detect and
becomes one the app can display exactly ("B has not recorded a voice sample yet"). The audio cannot
solve this; the product can, and only for the shared-device case, since separate devices give
per-stream attribution for free.

That boundary should be settled before any delivery plan: this whole gate concerns one microphone
with several people in front of it.
