---
type: measurement
phase: 7
measurement: M11
date: 2026-09-01
status: pre-registered
host: ssh.quanganh208.dev (i7-11700K, 8C/16T, 31GiB)
question: 'Is the bench instrument sound, or is the flat EER-vs-duration curve an artifact of trial construction?'
verdict: PENDING
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

_Not yet run._
