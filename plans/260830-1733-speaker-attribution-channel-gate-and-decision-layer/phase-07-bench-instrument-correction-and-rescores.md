---
phase: 7
title: 'Bench instrument correction and rescores'
status: pending
priority: P1
effort: '6d'
dependencies: [1]
---

# Phase 7: Bench instrument correction and rescores

## Overview

Four measurements, all CPU, all $0, none touching product code.

**Cost corrected 2026-09-01.** An earlier draft called three of these "rescores
of artifacts already on disk". That was wrong in both halves:

- **M13 is a re-run, not a rescore.** `settle.py:31-36` takes
  `vectors: np.ndarray`. No per-turn vector CSV exists anywhere in `results/` —
  `1s-m9-k2-assign.csv` is 73 rows of aggregates and `*-curve.csv` is counts by
  turn ordinal. M13 must re-simulate the meetings from the embedding cache at a
  **pinned seed**, asserting byte-identical reproduction of the existing
  aggregates _before_ any new number is read.
- **M11 needs the corpus, which is not on this host.** `corpora/`, `models/` and
  `fixtures/` are all absent here; only the two `.npz` caches are present, and
  `.gitignore` keeps them untracked. M11 runs where the corpus lives
  (`ssh.quanganh208.dev`), and corpus restoration is on the critical path to P2.

Revised effort: **6d**, not 4d.

The phase exists because Phase 1's verdict rests on an instrument nobody has
audited. Before the one-shot recording session in Phase 2 is designed against
those numbers, this phase asks whether the numbers are measuring what they claim.

**This phase can invalidate Phase 1 rather than extend it.** That is its point,
and M11 below is the check that can do it.

## Why the instrument is in doubt

Phase 1 concluded the cold arm fails at the real turn length. Three readings of
the committed artifacts put the _interpretation_ of that conclusion in question
without contradicting any recorded number.

### The EER-vs-duration curve is flat where every published curve is steep

`results/pairwise-summary-screen.csv`, campplus, clean:

| duration | 1.0s   | 2.0s   | 3.0s   |
| -------- | ------ | ------ | ------ |
| EER      | 21.22% | 20.50% | 20.49% |

**3.4% relative across a 3x change in audio.** Published curves for this class
of model move 2-4x over the same span. Far-field _does_ move (27.67 -> 22.67),
so the reverb condition carries a real duration term; the clean condition does
not.

A curve that is flat where the literature is steep has two candidate causes and
they demand opposite responses:

1. **A real ceiling** — the corpus, the trial protocol, or the domain gap sets
   error at ~20% and duration is a second-order term. Phase 1's verdict stands
   and the measurement program is sound.
2. **A broken instrument** — the trial construction is dominated by something
   that swamps duration (most plausibly cross-recording channel mismatch, which
   `results/channel-leakage.csv` half-confirms at +0.096 cosine). Then every
   number in this plan is suspect, including the ones that produced the FAIL.

**M11 separates them for the price of one cache rebuild.** Running it first is
not optional: designing a one-shot recording session against a broken instrument
spends the session and learns nothing.

### What the corpus can and cannot express — CORRECTED 2026-09-01

`speaker_bench/corpus.py:7-12` states the schema is exactly
`{audio: {array, sampling_rate}, speaker: string}` — **no session id, no video
id, no recording date, no distance label**. `speaker_bench/pairs.py` Rule 1
therefore uses scan-order distance as an explicit _stand-in_ for session
identity, and says so.

~~**Same-channel non-target pairs do not exist and cannot be constructed**, so a
within-session EER is not buildable on this corpus.~~ **RETRACTED — this was
false** (plan correction C2). `scripts/build_embedding_cache.py:151-152` builds
**one** `RoomConfig()` and **one** RIR and applies it to every clip of every
speaker. The far-field arm is therefore already a shared-channel condition, and
its non-target pairs are already same-"microphone" imposters. A synthetic
same-channel imposter set is one RIR-sharing pass away and is buildable today.

**Two things follow, and the second is uncomfortable:**

1. **M12 is re-scoped upward, not down.** It may compute a genuine same-channel
   EER on the synthetic shared channel, not merely a target-score shift.
2. **The far-field duration slope is confounded.** The 27.67 → 22.67 movement
   was this phase's only clean evidence _against_ the broken-instrument
   hypothesis. A single shared RIR inflates non-target cosines, so that slope is
   not clean either. **M11 loses its control.** See the revised kill rule.

**What survives about Phase 2:** the shared channel above is _synthetic_. P2
remains the only measurement of a **real** shared microphone with real browser
DSP — which is why it stays the decisive gate. The stronger claim, that no other
instrument could exist, was wrong.

### What is already on disk, and must not be re-measured

The adjacent-gap target-score shift this phase originally proposed as M12 is
**already computed**: `results/channel-leakage.csv` carries per-pair
`gap_low,gap_high,speaker,order_a,order_b,gap,cosine`, and the +0.096 figure
quoted above comes from it. `build_embedding_cache.py:79-82` ships the
`("spread", "adjacent")` policy pair for exactly this purpose. M12's deliverable
is therefore the **imposter** half, which is new — not the target half, which is
a read.

### One recorded verdict was decided on a metric that does not answer it

`results/1s-m10-settle.csv` carries `clean_rate`, `split_extra_mean`,
`merge_extra_mean`, `sessions_with_a_merge`, `sessions_with_a_split` — and **no
accuracy column of any kind**. The M9 files carry both `accuracy` and
`prefix_locked_accuracy`.

So "the settle pass does not ship" (12/36 merge-free unbounded, 0/36 capped) was
decided on merge/split cleanliness and **never asked what per-turn accuracy
was**. Under the display contract this plan now ships (Phase 4, defer then
back-fill), cleanliness is no longer the governing property. M13 measures the
cell that was never measured.

## Requirements

**Functional**

- M11 full-length control cell run **on a fixed trial population** and reported
  before M12-M14 are interpreted, with realised speaker and pair counts printed
  beside every EER.
- M12 builds the synthetic same-channel imposter set (shared RIR) and reports a
  genuine same-channel EER beside the cross-recording one. The adjacent-gap
  target half is a **read** of `channel-leakage.csv`, not a new measurement.
- M13 settle rescore reports the governing metric chosen in "Pre-registration"
  below, chosen and written down **before** the numbers are read.
- M14 AS-norm rescore reports EER and the change in threshold transfer loss.
- Every measurement emits per-turn or per-pair CSV, not only aggregates (constraint 11 — per-turn CSV).
- Every threshold derived here uses held-out speakers (constraint 12 — held-out splits).

**Non-functional**

- No product code changes in this phase. Phase 8 is withdrawn, so **this slice
  contains no product edit at all**.
- M11 runs on the host that holds the corpus. Corpus restoration is in scope and
  on the critical path to P2 — it is not free, and an earlier draft wrongly said
  no corpus was needed.
- `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` run immediately before each
  official measurement, exit code recorded in the report (plan constraint 11).

## Pre-registration — written before any number is read

Recording these now is the whole reason they are trustworthy later.

### M11 kill rule — REVISED 2026-09-01 after red team

The original two-outcome rule was **not safe to fire**. Two defects:

**(a) It compared different populations.** `pairs.py:90-108` admits a speaker
only when `utterance.duration_s >= bucket_s`, so the "curve" is already measured
over different sets: **80 speakers / 2992 pairs at 1.0s, 76 / 2844 at 2.0s,
74 / 2611 at 3.0s** (`results/pairwise-summary-screen.csv`). At full length the
floor vanishes and the eligible set grows again. More speakers means more
confusable pairs, so the "broken" branch was the _likely_ outcome regardless of
instrument health — and that branch stops the entire slice.

**(b) "Full length" is not a defined cell.** `pairs.py` Rule 2 says buckets are
never pooled and both sides of a pair are truncated to a common length;
`trials.py:196-209` shows `truncate_to` **raises** rather than pads. There is no
defined full-length pairing.

**Revised rule.** Hold the trial population fixed: compute the full-length-
eligible speaker set, then report **both** the full-length cell and a 1.0s cell
**restricted to that same set**, with realised speaker and pair counts printed
beside every EER. Define "full length" explicitly as a common long bucket, not
native per-clip length, so Rule 2 still holds.

Three outcomes, not two:

- **Restricted-set full-length EER in single digits while the restricted 1.0s
  cell stays ~20%** -> duration and/or channel is the effect, the instrument is
  sound, Phase 1's verdict stands.
- **Both restricted cells read ~20%** -> the instrument is suspect. **Do not
  schedule Phase 2.** Requote every number in this plan as conditional. This
  invalidates Phase 1's FAIL as readily as it would have invalidated a PASS.
- **The restricted and unrestricted cells disagree** -> the population, not the
  instrument, was driving the curve. Report it, fix the trial construction, and
  re-run before anything else is read.

**Note the control is weaker than it was.** Correction C2 removed the clean
far-field comparison this rule leaned on. M11 is now the primary evidence about
instrument health, which is a further reason not to let it fire on a
population artifact.

### M13 governing metric

`prefix_locked_accuracy` was the right gate while a rendered ordinal was
irrevocable. **Phase 4 now permits renumbering until a row is settled or a human
touches it**, so prefix stability is no longer the user-visible promise and
cannot be the governing metric by default.

The user-visible promise, stated first, metric derived second:

> Every turn ends the session carrying an ordinal. A turn's ordinal may change
> while it is pending. Once settled or human-touched, it never changes again.

Governing metric for M13 is therefore **settled-label accuracy**: the accuracy
of each turn's ordinal as of session end, scored without ground truth in the
assignment (first-appearance order), reported beside the Hungarian ceiling and
the gap (the oracle-is-a-ceiling rule). `prefix_locked_accuracy` is reported alongside as the _lower_
bound it now is, not as the gate.

**Denominator, stated before the run.** Every recorded accuracy in this repo is
over **attributed turns only** — `online.py:314-327` says so deliberately ("an
undecided turn is a different product failure from a mislabelled one"), and
`scoring.py:79-83` drops unlabelled turns from numerator _and_ denominator. The
M9 arms ran at `attribution_rate ~= 0.94`. **Under D8 coverage is 1.0 by
construction**, so a naive comparison would move purely on the denominator with
no change in mechanism.

M13 therefore reports **both**: settled-label accuracy over **all** turns, and
over the **previously-attributed subset**. The lever question is judged on the
subset; the product question on all turns.

**Bar — conjunctive, and split into two questions.**

- **Lever question.** Clears at **>= +5 points** on the previously-attributed
  subset on all three held-out splits **and** merge-free rate no worse than the
  online arm. The merge term is not optional: M10's rejection was _entirely_ a
  merge result (0/36 capped, `merge_extra_mean 0.560`, 184 sessions with a
  merge), a merge is this plan's designated unrecoverable failure, and
  `settle.py:60-63` enforces `k_max` **by merging the closest clusters** — so a
  bar without a merge term would reinstate the rejected component through the
  one metric that cannot see why it was rejected.
- **Dead band.** Between +3 and +5, or merge-free rate worse than the online arm:
  **undetermined**, escalate rather than choose. Below +3 on any split the
  clustering-side lever is closed.
- **Product question — separate and absolute.** M13 clears the _product_ bar only
  at **>= 0.85 over all turns** (D6). A relative improvement over a failing
  baseline is not a ship signal; 0.589 + 5 points is still 0.645.

### M14 bar

AS-norm clears if EER improves >=1.5 absolute points **and** threshold transfer
loss shrinks (currently mean +3.5pt, p90 +10.4pt, max +17.3pt). Improving EER
while leaving transfer loss intact is not a pass — transfer is the failure this
measurement is aimed at.

## Architecture

No runtime component changes. Work is confined to `benchmarks/speaker-id/`.

```
M11  build_embedding_cache.py --turn-s <full>   -> cache-full.npz
     run_pairwise.py                            -> results/pairwise-full.csv
     (decides whether M12-M14 mean anything)

M12  run_pairwise.py  + adjacent-gap arm        -> results/target-shift-adjacent.csv
     reports a SHIFT. No EER. No verdict.

M13  settle.py over existing per-turn CSVs      -> results/m13-settled-label.csv
     first-appearance ordinals, settled-label accuracy

M14  AS-norm over results/embedding-cache.npz   -> results/m14-asnorm.csv
     cohort speakers disjoint from every eval split
```

## Related Code Files

- Modify: `benchmarks/speaker-id/scripts/build_embedding_cache.py` — full-length
  mode (no truncation), stamped in the cache like `turn_s` already is
- Modify: `benchmarks/speaker-id/run_pairwise.py` — full-length cell; adjacent-gap
  target-shift arm reported beside the gap-separated arm, never replacing it
- Modify: `benchmarks/speaker-id/speaker_bench/scoring.py` — settled-label scorer;
  AS-norm scoring path
- Read only: `benchmarks/speaker-id/speaker_bench/settle.py` — already implements
  first-appearance renumbering; its docstring states the rule this phase scores
- Create: `benchmarks/speaker-id/results/pairwise-full.csv`,
  `target-shift-adjacent.csv`, `m13-settled-label.csv`, `m14-asnorm.csv`
- Create: report under `plans/260830-1733-.../reports/` per the naming convention

## Implementation Steps

1. Write the pre-registration section above into the report file **before**
   running anything, so the bars cannot be chosen after seeing results.
2. **M11 first.** Rebuild the cache at full length, stamped. Run the clean
   pairwise cell **restricted to the full-length-eligible speaker set**, plus a
   1.0s cell on that same restricted set. Print realised speaker and pair counts
   beside both. Apply the revised three-outcome kill rule and stop if it fires.
3. M12. Build the shared-RIR same-channel imposter set and report a genuine
   same-channel EER beside the cross-recording one. Read the adjacent-gap target
   shift from `channel-leakage.csv` — do not recompute it.
4. M13. **Re-run** the M9 session sampler at a pinned seed with the settled-label
   scorer, asserting byte-identical reproduction of the existing aggregates
   before reading any new number. Report both denominators, the merge-free rate,
   and signed count error separately;
   never net merge against split (signed count error, never netted).
5. M14. Build an impostor cohort from speakers disjoint from all three eval
   splits. Rescore. Report EER and transfer loss side by side.
6. Write the report. Requote any Phase 1 number this phase makes conditional.

## Success Criteria

- [ ] Pre-registration written and committed before the first measurement runs
- [ ] M11 full-length clean EER reported; kill rule applied in writing, whichever
      way it fell
- [ ] M12 reported as a target-score shift, with the no-imposter-pair limitation
      stated in the report body, not only in a footnote
- [ ] M13 settled-label accuracy reported beside the Hungarian ceiling and the
      gap (the oracle-is-a-ceiling rule); `prefix_locked_accuracy` reported as a lower bound
- [ ] M14 reports EER change **and** transfer-loss change; a pass requires both
- [ ] Per-turn / per-pair CSV emitted for every measurement (constraint 11 — per-turn CSV)
- [ ] `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded per
      measurement (constraint 11)
- [ ] Every number labelled measured / published / guess
- [ ] The ~30-speaker evidence limit restated in the report's conclusion (constraint 13 — 30-speaker evidence base)

## Risk Assessment

| Risk                                                      | Signal it broke                                          | Pre-decided response                                                                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M11 says the instrument is broken                         | Full-length clean EER ~20%                               | **Stop the whole slice.** Do not schedule Phase 2. Requote every number in this plan as conditional. Repairing trial construction becomes the next phase, and Phase 1's FAIL is void along with everything else |
| Bars get chosen after seeing results                      | Pre-registration section written after a measurement ran | The measurement is void and is re-run. This is why step 1 exists                                                                                                                                                |
| M12's same-channel EER gets read as a real-channel result | Any report quotes M12 as evidence about production       | Correct in place. M12's shared channel is a **synthetic** RIR; only P2 measures a real shared microphone                                                                                                        |
| Settle rescore flatters itself                            | M13 improves while signed count error worsens            | Report both. A settle that raises accuracy by merging two people is a regression, not a win — merge error is never netted against split error (signed count error, never netted)                                |
| AS-norm cohort leaks into eval                            | Cohort speaker appears in any eval split                 | Void the run. Constraint 12 is not negotiable                                                                                                                                                                   |
| The full-length rebuild is expensive                      | Cache rebuild exceeds a working day                      | Acceptable. It is still the cheapest possible answer to "is the instrument sound", and it is a prerequisite for spending a one-shot human recording session                                                     |
