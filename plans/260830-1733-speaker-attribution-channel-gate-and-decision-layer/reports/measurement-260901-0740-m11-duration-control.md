---
type: measurement
phase: 7
measurement: M11
date: 2026-09-01
status: measured
host: ssh.quanganh208.dev (i7-11700K, 8C/16T, 31GiB)
question: 'Is the bench instrument sound, or is the flat EER-vs-duration curve an artifact of trial construction?'
verdict: 'UNDETERMINED — R = 1.40x, inside the pre-registered escalation band. Population check FIRED: the published per-bucket duration curve is void as a duration measurement. P1 is neither invalidated nor confirmed.'
---

# M11 — duration control on a fixed trial population

**Pre-registration. Written and committed before any number was read.** Anything
below the `## Results` heading did not exist when the bars were chosen.

## Why this measurement exists

`results/pairwise-summary-screen.csv`, campplus, clean:

| duration | 1.0s   | 2.0s   | 3.0s   |
| -------- | ------ | ------ | ------ |
| EER      | 21.22% | 20.50% | 20.49% |

3.4% relative across a 3x change in audio. Published curves for this model class
move 2-4x over the same span. Two causes, opposite responses:

1. **Real ceiling** — corpus / protocol / domain gap sets error near 20% and
   duration is second-order. P1's FAIL stands, the program is sound.
2. **Broken instrument** — trial construction is dominated by something that
   swamps duration. Then every number in this plan is suspect, _including_ the
   FAIL, and the one-shot P2 recording would be spent calibrating against noise.

Correction C2 removed this phase's only other control: the far-field duration
slope (27.67 -> 22.67) is confounded, because `build_embedding_cache.py:151-152`
shares one RIR across every clip and that inflates non-target cosines. **M11 is
now the primary evidence about instrument health.**

## Design — the confound the original rule did not close

`pairs.py:90-108` admits a speaker only when `utterance.duration_s >= bucket_s`,
so the published "curve" is measured over **different populations**: 80 speakers
/ 2992 pairs at 1.0s, 76 / 2844 at 2.0s, 74 / 2611 at 3.0s. More speakers means
more confusable pairs. A duration curve read across changing populations cannot
separate a duration effect from a population effect in either direction.

**This run holds everything fixed except truncation length.** One trial list is
built at the long bucket; the _same pairs, same clips, same speakers_ are then
scored twice, truncated to the long length and to 1.0s. Nothing else varies —
not the speaker set, not the pair sample, not the seed.

- **Long bucket L = 8.0s.** Chosen from the index before running, on population
  cost: eligible speakers by bucket are 1.0s -> 80 contributing, 4.0s -> 66,
  **8.0s -> 48**, 12.0s -> 43. 8.0s is an 8x duration lever (against the
  published curve's 3x) while retaining 60% of the 1.0s speaker set, and it
  matches the ~8s mean utterance length published evaluations of this model
  class report against. Corpus duration p50 is 3.00s, p75 5.40s, p90 12.02s.
- **Model: campplus only.** P5 closed the model axis; campplus is the model every
  number in this plan was measured with. This is a question about the
  instrument, not about model choice.
- **Conditions reported separately, never pooled.** Clean is the diagnostic cell,
  because clean is where the curve is flat. Far-field is reported beside it and
  is _not_ clean evidence (C2).
- Deterministic per-clip noise seeding, so the far-field arm is reproducible and
  the two duration arms are not separated by an rng draw order.

## Pre-registered statistic and bars

**Primary statistic:** `R = EER(1.0s restricted) / EER(8.0s restricted)`, campplus,
clean, over identical pairs.

The published-curve comparison is a _ratio_ claim ("2-4x over the span"), so the
statistic is a ratio. Reported with realised speaker and pair counts beside every
EER, per constraint 11.

| Reading            | Meaning                                                                                                                                                      | Pre-decided response                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R >= 2.0**       | Duration is a first-order effect once the population is held fixed. The flat 1-3s curve was a bucket-range and population artifact, not a broken instrument. | **Instrument sound.** P1's verdict stands. Proceed to M12-M14, then P2.                                                                                     |
| **R <= 1.25**      | An 8x duration change moves EER almost not at all on a fixed population. No amount of audio helps.                                                           | **Instrument suspect. Stop the slice.** Do not schedule P2. Requote every number in this plan as conditional. P1's FAIL is void along with everything else. |
| **1.25 < R < 2.0** | Undetermined.                                                                                                                                                | Report and escalate to the user. Do not pick a branch silently.                                                                                             |

**Absolute anchor, independent of R.** If restricted full-length clean EER lands
in single digits, the instrument is sound regardless of what R reads — a model
that reaches single-digit EER on this corpus is measuring identity.

**Population check, run in the same pass.** Compare restricted 1.0s clean EER
against the recorded unrestricted 1.0s clean EER (21.22%). A disagreement of
more than 2 absolute points means **the population, not the instrument, was
driving the published curve**: report it, fix trial construction, and re-run
before any other number in this phase is read.

**Why this refines the bar written in `phase-07`.** That file's first branch
required "single digits while the 1.0s cell stays ~20%", and its second required
"both cells ~20%". Between them sits a wide, likely region — this repo's own
cited reference is 13.19% for a VoxCeleb-trained model on Vietnamese at full
length, and campplus is zh+en trained, so Vietnamese is cross-lingual for it too.
A rule with an unreachable pass branch and an undefined middle is not safe to
fire. The absolute anchor is kept verbatim; the ratio makes the middle decidable.
Written before the run, with the reason, per the phase's own anti-hindsight rule.

## Provenance

- `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded below,
  captured immediately before the official run (constraint 11).
- Per-pair CSV emitted, not only aggregates (constraint 11).
- ~30-speaker evidence limit restated in the conclusion (constraint 13).
- Every number labelled measured / published / guess.

## Results

Run 2026-09-01 on `ssh.quanganh208.dev`. `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run
pytest` immediately before the run: **332 passed, exit 0**. Artifacts:
`results/m11-duration-control.csv` (6 cells), `m11-duration-control-pairs.csv`
(19,596 pair rows), `m11-duration-control.log`.

The host checkout sits on `main`, but every bench file this run touches is
byte-identical to this branch (sha256 compared before the run for
`run_pairwise.py`, `build_embedding_cache.py`, `pairs.py`, `trials.py`,
`scoring.py`, `settle.py`), plus `run_duration_control.py` copied from it.

**Population, identical in all six cells:** 48 contributing speakers of 75
eligible, 1633 same + 1633 different pairs. [measured]

campplus, same clips throughout, only the truncation length differs:

| condition | 8.0s       | 3.0s   | 1.0s       | 1.0s -> 8.0s |
| --------- | ---------- | ------ | ---------- | ------------ |
| **clean** | **17.15%** | 18.25% | **24.00%** | **1.40x**    |
| far-field | 18.68%     | 22.29% | 30.13%     | 1.61x        |

Far-field is reported, not read: one shared RIR inflates its non-target cosines
(C2), so its slope is not independent evidence.

### The population check fired [measured]

Restricted 1.0s clean **24.00%** against the recorded unrestricted 1.0s clean
**21.22%** — **2.78pt apart**, over the 2pt tolerance.

**So the published per-bucket curve was partly a population artifact, and the
pre-registered response applies: it is void as a duration measurement.** On a
fixed population the same span reads 24.00% -> 18.25%, a **1.32x** move, where
the published curve read 21.22% -> 20.50%, a **1.04x** move. The duration effect
was there; a harder speaker set at longer buckets was cancelling it out.

Note the direction is the opposite of what the phase file assumed. It reasoned
"at full length the floor vanishes and the eligible set grows again. More
speakers means more confusable pairs." Here **fewer** speakers (48 vs 80) scored
**worse** at 1.0s. Speaker count is not what drives the difference — which
speakers, and how their clips were recorded, is.

### The primary statistic: UNDETERMINED [measured]

**R = 1.40x**, inside the pre-registered undetermined band (1.25, 2.00). The
pre-registered response is to report and escalate, not to pick a branch. This
report does not declare the instrument sound and does not declare it broken.

Two readings sit either side, and both are supported by the same table:

- **Toward sound.** The response is real, monotone and ordered across all three
  cells in both conditions. Nothing here behaves like a measurement swamped by
  a channel term that ignores duration.
- **Toward suspect.** 1.32x over the literature's own 1-3s span, against the
  2-4x that span is quoted at — the gap the phase opened is narrowed, **not
  closed**. And the absolute number is the harder fact: **17.15% EER on 8
  seconds of clean audio**. campplus is published near 1% on its own domain. An
  8x increase in audio buys 6.85 points and then saturates ~17 points above
  where this model is known to sit.

**The absolute anchor was not met.** 17.15% is not single digits.

### A third reading, offered as the honest one, and not a verdict

The result is most consistent with **a real ceiling that is not about duration
at all** — a domain gap between a zh+en-trained extractor and this Vietnamese
broadcast corpus, on top of whatever within-speaker channel variation survives
`MIN_INDEX_GAP`. Duration is a second-order term on top of a large constant.

If that is right, then P1's FAIL stands _as a statement about this model on this
corpus_, the flat curve was never the anomaly it looked like, and no amount of
audio is the lever. It also predicts the OQ9 result rather than merely
coexisting with it: an extractor that cannot reach single digits with 8 seconds
is exactly one whose 1-second argmax scores chance.

**But that is a hypothesis this measurement did not test**, and it is precisely
the kind of after-the-fact story the pre-registration exists to stop being
adopted silently. It is written here as a reading to be confirmed or killed, not
as an outcome.

### Threshold transfer, observed in passing [measured]

The EER threshold moves with duration far more than the EER does: clean
**0.335 -> 0.264 -> 0.192** across 8.0s / 3.0s / 1.0s. A threshold calibrated at
one turn length is badly wrong at another, which is the failure M14 was aimed
at, now seen on the duration axis as well as the cohort axis.

### What this changes in the plan

- **Every per-bucket duration comparison in P1 is conditional.** The population
  moved under it. Cells measured _within_ one bucket — the M9 session arms, the
  gate cell — are untouched, because those never crossed populations.
- **`results/pairwise-summary-screen.csv`'s duration curve is not a duration
  curve.** It should be quoted with its speaker counts (80 / 76 / 74) or not
  quoted.
- **M12-M14 must hold their populations fixed**, and say which one.
- **P1's FAIL is not invalidated by this run**, and not confirmed by it either.

### Deviation from `phase-07`'s file, recorded

- `phase-07` lists `run_pairwise.py` as the file to modify. The control is a new
  `run_duration_control.py` instead: this repo's convention is one script per
  question (`run_pairwise`, `run_session`, `run_settle`, `run_channel_delta`,
  `run_latency`), and `run_pairwise.py` is already 364 lines with a different
  gate and a different exit contract.
- The 3.0s cell was added **after** the first run, which scored 8.0s and 1.0s
  only. It changed no bar and no verdict — R was 1.40x before and after. Its
  purpose is comparability: the published claim is quoted over 1-3s, and a ratio
  measured over 1-8s cannot be held against it. Disclosed because it was decided
  with the first run's numbers already visible.

### Evidence limit (constraint 13)

48 contributing speakers, one Vietnamese broadcast corpus, a synthetic far-field
channel, and no browser DSP anywhere. Nothing here measures a real shared
microphone; P2 remains the only instrument that would.

## Unresolved questions

1. **R = 1.40x is undetermined and the pre-registered response is to escalate.**
   The user decides whether 1.32x over the literature's own span, against a
   quoted 2-4x, counts as the instrument responding or the instrument failing.
   The two branches are opposite: proceed to M12-M14 and then spend the P2
   recording, or stop the slice and repair trial construction first.
2. **Is 17.15% at 8s a domain gap or a residual channel effect?** Untested. A
   speaker-disjoint cohort or a second corpus would separate them; the bench has
   neither today.
3. **Does `truncate_to` taking the _leading_ second disadvantage the 1.0s arm?**
   Every clip here is at least 8s, so its first second may carry onset and
   breath that a natively short clip would not. Unmeasured, and it inflates R in
   the direction that favours "sound".
4. **Should the published per-bucket curve be deleted or annotated?** It is
   quoted in `phase-07` and in `plan.md` as evidence. It is now known not to
   measure what its axis claims.
