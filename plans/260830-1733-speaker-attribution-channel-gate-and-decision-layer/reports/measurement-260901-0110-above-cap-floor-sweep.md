---
type: measurement
phase: 4
date: 2026-09-01
supersedes: null
verdict: the recorded FAIL was a harness artifact, but the honest D8 number is ~0.77-0.86 against a 0.85 bar — the acoustic layer cannot satisfy D13 alone. See the addendum, which corrects this report's own headline.
---

# The above-cap arms were never measured, and the cell they were measured in is not what it looked like

## What was recorded, and why it was wrong

`results/1s-m9-k2-abstain.csv` and `1s-m9-k2-raise_tau.csv` carry
`count_constraint=unreachable`, `verdict=NO-CONFIG`, empty accuracy columns, on
every `campplus, far-field, N=2, cold` row — 3/3 splits each. The plan read that
as "the above-cap decision has no input" and recorded that P4's own stop rule had
fired.

**It is a harness artifact.** `run_session.calibrate` filters

```python
target_rate = ATTRIBUTION_FLOOR + CALIBRATION_MARGIN   # 0.80 + 0.14 = 0.94
...
if rate < target_rate:
    continue        # discarded BEFORE the count criterion is evaluated
```

and both non-default policies withhold attribution above the cap **by design** —
`abstain` returns `label=None` (`online.py:263`), `raise_tau` raises the assign
bar (`:247-248`) so more turns fall through. Demanding 94% live attribution from
a policy whose purpose is to attribute less is structurally unsatisfiable.

Measured directly (105-point grid, 150 calibration meetings/point):

| above_cap   | max attribution rate reachable | grid points clearing 0.94 |
| ----------- | ------------------------------ | ------------------------- |
| `assign`    | 0.9953                         | **12 / 105**              |
| `abstain`   | 0.8747                         | **0 / 105**               |
| `raise_tau` | 0.7927                         | **0 / 105**               |

`NO-CONFIG` says the calibrator could not grade these policies. It says nothing
about whether they attribute correctly.

## Validity check — the diagnostic reproduces the recorded run exactly

`assign` at floor 0.94 scores prefix-locked **0.5887** on held-out speakers.
The recorded gate cell is 0.569 / 0.627 / 0.570 → mean **0.5887**. Identical.

The sweep therefore measures the same quantity on the same scale as the recorded
numbers, and every row below is comparable to them.

## The floor sweep

Thresholds chosen on **calibration speakers only**, scored on **held-out speakers
only**, 3 splits, 400 evaluation meetings — the harness's own shape (constraint 12
preserved). The only change: the attribution floor is **swept, not fixed**. No
harness constant was modified; nothing was written to `results/`.

Cell: campplus / far-field / N=2 / cold / 1.0s cache / 31-speaker pool.
Bars: accuracy ≥ 0.85, exact-count ≥ 0.90. "shippable" = prefix-locked column.

| policy        | floor       | eval acc (ceiling) | **prefix-locked** | eval rate | exact  | shippable |
| ------------- | ----------- | ------------------ | ----------------- | --------- | ------ | --------- |
| assign        | 0.94        | 0.8025             | **0.5887**        | 0.9800    | 1.0000 | **0/3**   |
| assign        | 0.80        | 0.8426             | 0.7399            | 0.7859    | 0.9850 | 0/3       |
| assign        | 0.65        | 0.8825             | 0.8252            | 0.6310    | 0.9258 | 0/3       |
| assign        | 0.60        | 0.8804             | 0.8245            | 0.5869    | 0.9275 | 1/3       |
| **abstain**   | **0.65**    | 0.9064             | **0.8809**        | 0.5968    | 0.9417 | **3/3**   |
| abstain       | 0.60        | 0.9165             | 0.8891            | 0.5431    | 0.9450 | 2/3       |
| abstain       | 0.70        | 0.8920             | 0.8522            | 0.6517    | 0.9783 | 2/3       |
| abstain       | 0.80        | 0.8617             | 0.8146            | 0.7551    | 0.9458 | 0/3       |
| abstain       | 0.90 / 0.94 | —                  | —                 | —         | —      | NO-CONFIG |
| **raise_tau** | **0.65**    | 0.9036             | **0.8731**        | 0.5765    | 0.9750 | **3/3**   |
| **raise_tau** | **0.60**    | 0.9039             | **0.8706**        | 0.5539    | 0.9808 | **3/3**   |
| raise_tau     | 0.70        | 0.8805             | 0.8494            | 0.6298    | 0.9392 | 1/3       |
| raise_tau     | 0.80+       | —                  | —                 | —         | —      | NO-CONFIG |

Full output: `/tmp/diag-floor-sweep.log` on the bench host.

## What this changes

**The far-field N=2 cold cell reaches prefix-locked 0.87–0.88 with 3/3 shippable
passes.** The plan has been built on 0.589 from that same cell. The difference is
entirely the attribution floor.

**The mechanism was never the thing failing.** Three arms, one harness constant.

**The two arms the calibrator discarded are the two that pass.** `assign` — the
only arm with recorded numbers, and therefore the one the plan was drifting
toward by default — is the _worst_ of the three at every floor.

**The decision moved.** It is no longer "which above-cap policy". Both work. It
is now **"how many turns may go unattributed live"**, because that is what the
floor sets. At the passing configurations the live attribution rate is
**0.54–0.60**, i.e. roughly **40–46% of turns defer** and are back-filled under
D8. That is a product question — P6's S4b, time-to-resolve — not a bench question.

**The trade is monotone and behaves exactly as the mechanism predicts:** lower
floor → higher accuracy → lower live attribution. That regularity is itself
evidence the diagnosis is right.

## Limits — these are not yet gate numbers

1. **The floor was swept, then good rows were read off.** Selecting a floor after
   seeing the result is fitting. A floor must be **chosen and pre-registered**
   before any of these becomes a verdict.
2. **`raise_tau` used `tau_assign_capped_delta = 0.05`, unswept.** An arbitrary
   value picked for the diagnostic. It is a free hyperparameter and it was not
   calibrated.
3. **Evidence base unchanged: 31 speakers**, 15-16 evaluated per split, and the
   three splits are shuffles of the same pool (constraint 13). This bounds
   confidence in both directions.
4. **Far-field is synthetic** — one `RoomConfig()`, one RIR shared across all
   speakers (correction C2). P2 still owns the real channel.
5. **`SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` was not run before this**, so
   it does not satisfy constraint 11 and is a diagnostic, not an official
   measurement.
6. **The instrument audit (P7-M11) has not run.** If it finds the trial
   construction broken, these numbers are void along with every other number in
   the plan.

## Consequences for the plan

- **D5 / P4 Step 0:** the recorded stop signal did not fire for the reason
  recorded. The above-cap fork has three live options, and two of them pass.
- **P2's stakes change.** The plan framed the real channel as sitting between
  clean 0.785 and far-field 0.589. The far-field floor was 0.589 only at a floor
  the product no longer needs. P2 still decides, but the range it decides within
  is much better than recorded.
- **P6-S4b is promoted.** Time-to-resolve was a reported signal; with ~40% of
  turns deferring at the passing configurations, it becomes the governing
  product constraint.
- **The `CALIBRATION_MARGIN = 0.14` question is now load-bearing.** It was
  derived from measured threshold transfer loss for a fixed-floor design. Under a
  swept or lowered floor its derivation needs restating.

## Unresolved questions

1. **What live attribution rate is acceptable?** Everything above turns on it,
   and it cannot be answered from the bench. At 0.60 roughly 4 turns in 10 show a
   pending chip before back-fill.
2. **Should the attribution floor remain a calibration filter at all**, or become
   a reported cost with accuracy as the sole objective? The latter matches D8; the
   former is what every recorded number used.
3. **`tau_assign_capped_delta` needs sweeping** before `raise_tau` can be compared
   fairly to `abstain`.
4. Does P7-M11 validate the instrument? Everything here is conditional on it.

---

# Addendum — in-session re-scoring measured, and it does not save D13

Added 2026-09-01, after the floor sweep above.

## What was tested

D13 requires a deferred turn to be filled **during** the session, and rules out
`settle()` as the filler (it re-clusters from scratch and enforces `k_max` via
`fcluster(maxclust)` — the merge error M10 rejected it for).

Candidate mechanism: after each turn, re-score every still-pending turn against
the attributor's **current** centroids; commit it if it now clears `tau_assign`.
Strictly weaker than settle — it never merges clusters and never renumbers a
committed turn, so P3's monotone merge invariant holds by construction.

## Result

`abstain`, k_max=2, calibration floor 0.65, thresholds re-calibrated at each
length, campplus / far-field / N=2 / cold / 1.0s, 400 meetings x 3 splits.

| turns/meeting | immediate | resolved | **unresolved** | acc imm | acc res | exact  | D8 @0.50 | D8 @0.73 |
| ------------- | --------- | -------- | -------------- | ------- | ------- | ------ | -------- | -------- |
| 10            | 0.5968    | 0.0937   | **0.3096**     | 0.9185  | 0.7336  | 0.9417 | 0.7716   | 0.8439   |
| 20            | 0.5811    | 0.0680   | **0.3509**     | 0.9379  | 0.7637  | 0.9642 | 0.7724   | 0.8544   |
| 40            | 0.5881    | 0.0644   | **0.3475**     | 0.9374  | 0.7838  | 0.9742 | 0.7755   | 0.8567   |

Waits: mean 2.84 / 5.40 / 8.60 turns; p90 6 / 11 / 20; max 8 / 18 / 38.
Resolved within 3 turns: 69.3% / 41.5% / 30.7%.

## Reading

**The hypothesis was that the 31% unresolved tail at 10 turns was an artifact of
meeting length.** It is not. The tail rises slightly and plateaus at ~35%; the
resolve rate _falls_ with length. Waits do scale with meeting length — which
confirms they were length-bounded — but that only means the turns that never
resolve wait longer before being abandoned. In-session responsiveness gets worse,
not better, as sessions lengthen.

**~35% of turns are structurally unreachable by re-scoring.** Those vectors never
clear `tau_assign` against any centroid, at any accumulated evidence.

**Honest accuracy, D8 denominator.** With the tail force-assigned, overall lands
**0.77-0.86** against a 0.85 bar. The upper bracket assumes the forced tail scores
as well as turns the mechanism _could_ resolve, which is not credible — the tail
is exactly the residue it could not. The real figure sits near the lower end.

**This corrects the floor sweep above.** Its 0.8809 excluded unresolved turns from
the denominator. Under D8, coverage is 1.0 by contract, and the honest number is
materially worse. That is the same denominator error the red team flagged, and it
recurred here.

## Two risks retired

- **Self-reinforcing centroid decay did not appear.** `acc imm` rose with length
  (0.9185 -> 0.9379 -> 0.9374). The 83%->71% within-session decay recorded
  elsewhere does not reproduce in this configuration.
- **The speaker-count problem is solved.** Exact-count 0.9417 -> 0.9742, clear of
  the 0.90 bar and improving with length. **What fails is labelling, not counting** —
  which is the opposite of what the plan's original framing assumed.

## What this forces

The acoustic layer cannot satisfy D13 alone. The tail is turns whose _voice_ is
not separable; no amount of accumulated acoustic evidence reaches them.

An ambiguous-voiced turn still has a **language**. Per-turn LID (D10) is the only
mechanism in the option screen that touches this tail, and D10 was deferred on
the assumption that the acoustic layer would carry the slice. That assumption is
now measured false.

## Limits

1. Diagnostic, not an official measurement: `SPEAKER_BENCH_REQUIRE_PARITY=1 pytest`
   was not run first (constraint 11).
2. `abstain` only. `raise_tau` was not swept across lengths.
3. Prefix-locked mapping here names a cluster by its first _committed_ turn, which
   may be a resolved turn — so `acc imm` is not directly comparable to the floor
   sweep's `score_prefix_locked` figure.
4. Force-assign accuracy is bracketed, not measured. Measuring it requires
   choosing a force-assign rule, which is undecided (open question 9).
5. Evidence base unchanged: 31 speakers, synthetic far-field, instrument audit
   (P7-M11) still not run.
