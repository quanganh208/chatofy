---
title: 'Phase 3: Bench 1 — pairwise EER screen (Checkpoint 1)'
status: completed
phase: 3
priority: P1
effort: '1d'
dependencies: [1, 2]
---

# Phase 3: Bench 1 — pairwise EER screen (Checkpoint 1)

## Overview

Measure how well each candidate model separates same-speaker from different-speaker pairs on the
real channel, per duration bucket. Select the model, derive candidate thresholds, and run the first
kill checkpoint.

## Requirements

**Functional**

- [ ] Same/diff cosine distributions per model × duration bucket × distance condition
- [ ] EER computed per cell, not pooled
- [ ] τ_hi / τ_lo derived from the distributions
- [ ] Gate script exits non-zero when Checkpoint 1 fails

**Non-functional**

- [ ] Pair construction rules enforced in code, not left to the caller
- [ ] Histograms emitted as images

## Architecture

**Pair construction is where a bench lies to you.** Same-speaker pairs drawn from _adjacent_
segments share position, AGC state, and reverb tail. Their cosine similarity is inflated by shared
channel rather than shared identity, EER comes out low, and the gate passes a model that will fail
in the room. So the rule is enforced, not advised:

- Same-speaker pairs: **temporally distant** (≥5 min apart) and **cross-position** (0.5m vs 2m).
- Different-speaker pairs: matched conditions, so the contrast is identity rather than channel.

**Buckets, never pooled.** Report 1s / 2s / 3s by net speech separately. Pooling lets healthy 3s
turns average away a catastrophic 1s bucket — and short turns are precisely the regime in doubt.

**Threshold derivation.** τ_hi at ~1% false-accept on diff-pairs (conservative: a wrong merge
poisons a centroid). τ_lo at ~5–10% miss on same-pairs. The dead zone between them is the design's
main defense and its width is an output of this phase, not an input.

**Do not trust the sherpa demo defaults** (~0.5–0.6). They are channel-dependent and no published
threshold transfers to this setup.

## Checkpoint 1 — the gate

**Metric:** EER over trial pairs constructed from VoxVietnam's test split, per duration bucket, on
the simulated **far-field** condition, read at the **2s** bucket.

**Corrected during implementation — twice.** The metric first said "Vietnam-Celeb-H, negatives
matched on gender and dialect". Vietnam-Celeb turned out not to be fetchable (its trial lists ship
inside a manual Google Drive archive under an unstated licence), so pairs are constructed from
VoxVietnam's speaker labels instead. Negatives are therefore matched on nothing — no gender or
dialect control — which makes them EASIER than Vietnam-Celeb-H's. That is a weaker screen than
planned and the gate report must say so rather than imply the harder list was used.

**Data source changed — corpus, not self-recording.** The screen now runs on public Vietnamese
speaker-verification corpora with official trial lists (Phase 1), not a 3-5 person session. This is
a stronger screen by a wide margin: 120 test speakers and ~55k matched pairs, versus a few hundred
pairs a small session could construct under the time/position rules. It is also weaker in one
specific way — corpus audio has not passed through production's `getUserMedia` DSP — which is why
Checkpoint 1 stays necessary-but-not-sufficient and Phase 7 measures that delta separately.

**A published reference exists for this exact cell.** On Vietnam-Celeb's lists, a VoxCeleb-pretrained
ECAPA scores 13.19 (E) / 16.52 (H) and a Vietnamese-trained one 6.31 / 8.62 — at FULL utterance
length, clean channel. Two consequences. First, the `wespeaker_en` baseline is likely already below
the bar before truncation, which would settle the advisory disagreement about VoxCeleb transfer with
a number instead of two opinions. Second, a candidate scoring far better than 6.31 at the 2s bucket
is not a triumph, it is a bug — a Vietnamese-trained model does not get beaten that easily by a
Mandarin-trained one on shorter audio.

- **≤10% EER for at least one model → PASS.** Select that model; carry its τ_hi/τ_lo to Phase 4.
- **10–15% → MARGINAL.** Run the remediation lever before deciding: re-cut with TEN VAD
  (`TenVadModelConfig`, already exposed in the pinned sherpa-onnx) and re-run this bench. A
  better-placed cut may recover it. If still >10%, treat as FAIL.

  Note the published baseline sits inside this band: a VoxCeleb-trained model measures 13.19/16.52
  on Vietnamese at full length. So MARGINAL is the _expected_ outcome for an ill-matched model, not
  a surprise, and the branch should not be read as "nearly passing".

- **>15%, or all models fail → KILL.** Stop. Do not start Phase 4. Re-open options with the user:
  named enrollment (approach C), a longer-turn UX, or labels declared explicitly best-effort.

This screen is **necessary but not sufficient** — passing it does not imply the feature works
end-to-end. That is Phase 4's job.

## Pair construction — the rules, and where they came from

**The corpus has no session id.** VoxVietnam's parquet is `{audio, speaker}`: no video id, no
timestamp, no distance. So the plan's original rules — same-speaker pairs at least 5 minutes apart
and cross-position — cannot be applied as written. What replaced them was measured, not assumed.

**`scripts/probe_channel_leakage.py` established that scan order is a usable proxy** for "different
source recording", because the corpus was assembled per speaker per source:

| index gap   | mean same-speaker cosine |
| ----------- | ------------------------ |
| [1, 5)      | 0.6315                   |
| [5, 25)     | 0.5852                   |
| [25, 100)   | 0.5301                   |
| [100, 1000) | 0.5167                   |

Adjacent clips score **+0.096** higher than distant ones. Paired within speaker the effect is +0.091
(Wilcoxon p=0.013), so it is not an artifact of which speakers can supply which gaps — though the
per-speaker sign test is only 14/23 (p=0.20), making this a real average effect with high variance
rather than a universal law.

**The threshold was then measured against its own cost**, because a gap rule excludes speakers whose
clips sit close together and most speakers here hold only 8-16 clips:

| min gap | speakers | target pairs | mean cosine |
| ------- | -------- | ------------ | ----------- |
| 0       | 143      | 4553         | 0.5598      |
| **25**  | **76**   | **2844**     | **0.5275**  |
| 100     | 39       | 1498         | 0.5262      |

25 removes 0.032 of the 0.034 total inflation. Going on to 100 halves the speaker count for a
further 0.0013 — it would have made the gate describe 39 voices instead of 76, for nothing. A
threshold picked for looking prudent would have taken that trade silently.

**Residual, stated rather than solved.** Two clips 25 rows apart may still come from one long video.
That residual is unmeasurable with this corpus and belongs in the gate report as a limitation of the
number, not as a solved problem.

**Speaker imbalance is capped.** Utterances per speaker run 1 to 2,559 against a median of 8, so
`MAX_PAIRS_PER_SPEAKER` bounds each speaker's contribution and the effective speaker count is
reported beside every EER.

## The far-field condition is simulated

Corpus audio carries no distance label, so the condition is created: a 5 x 4 x 2.8m room, talker at
2.00m, **measured RT60 0.507s**, plus Gaussian noise at 15dB SNR, applied in that order because
sensor and HVAC noise reaches the microphone without the talker's room transfer applied to it.

`pyroomacoustics` does the acoustics. A hand-rolled image-source method was written first and was
wrong: its RT60 tracked the array bound at ~0.75x the array length and barely responded to wall
absorption, because the tail was being truncated rather than decaying. It was measuring its own
array size. Acoustics offers no analytic oracle the way EER does, so that would have survived a
green test suite; the library is the right dependency and the local version was deleted.

Two further defects surfaced while testing it, both of which would have silently shifted every
augmented clip:

- Source and microphone were both on the room's centre line, so the two side-wall reflections
  travelled identical paths and summed to something **louder than the direct arrival**. Moving the
  geometry off-centre removed it.
- `apply_rir` aligned on `argmax`, which is the loudest sample rather than the first arrival. With
  the symmetric room that put the direct path ~200 samples late. Alignment now uses the first
  arrival above a threshold, which is correct for any RIR rather than for this one.

**What this cell is worth.** It is a _harder synthetic condition_, not a measurement of production:
no browser DSP anywhere, and a simulated room stacked on already-broadcast-processed audio. The gate
reads it because it is the conservative of the two available cells. Phase 7 measures the real
channel.

## Related Code Files

- Create: `benchmarks/speaker-id/run_pairwise.py` — the bench entrypoint + gate exit code
- Create: `benchmarks/speaker-id/speaker_bench/corpus.py` — streaming parquet access + index
- Create: `benchmarks/speaker-id/speaker_bench/pairs.py` — the measured pair rules
- Create: `benchmarks/speaker-id/speaker_bench/augment.py` — simulated far-field
- Create: `benchmarks/speaker-id/scripts/probe_channel_leakage.py` — decides the gap rule
- Create: `benchmarks/speaker-id/results/` — CSV + PNG artifacts (gitignored)
- Read: Phase 1 `trials.py` + fetched corpora, Phase 2 `embed.py` / `segment.py`

## Implementation Steps

1. Load the official trial lists with Phase 1's `trials.py`; resolve each side to corpus audio.
2. Truncate each utterance to the 1s / 2s / 3s buckets through `to_pcm16_16k`, so the extractor sees
   production framing rather than a one-shot resample.
3. Run the far-field condition by RIR convolution + MUSAN-style noise, and report clean and
   augmented as separate cells — never pooled, since the gate reads the far-field one.
4. Embed every segment once, cache the vectors; compute cosine per pair.
5. Compute EER per (model × bucket × condition); write per-pair CSV and per-cell summary CSV.
6. Emit same/diff histograms as PNG per cell — a single EER can hide a bimodal distribution, and the
   picture is what makes that visible.
7. Derive τ_hi / τ_lo from the far-field 2s cell of the selected model, and record which corpus
   and which channel they came from — Phase 7 may invalidate them.
8. Implement the gate: exit non-zero on FAIL, print the decision and the numbers behind it.

## Success Criteria

- [ ] Per-pair CSV, per-cell summary CSV, and per-cell histogram PNGs written
- [ ] EER reported per bucket and per distance condition, never pooled
- [ ] Pair-construction rules asserted in code and demonstrably enforced
- [ ] τ_hi / τ_lo derived and recorded with the false-accept / miss rates they correspond to
- [ ] Gate script exits non-zero on failure
- [ ] Checkpoint 1 decision recorded: PASS (with model), MARGINAL (with remediation result), or KILL

## Risk Assessment

- **Falsely passing via lazy pairs (highest).** Signal: EER suspiciously better than the ~5–12%
  literature expectation for far-field 2s. Response: audit the sampled pairs' timestamps and
  distances before believing the number. Treat a too-good result as a bug until proven otherwise.
- **Too few valid pairs.** Largely retired by the corpus move — the official lists carry ~55k pairs
  per condition. Signal: a truncation bucket that drops most utterances because they are shorter
  than the bucket. Response: report the surviving pair count beside every EER; a cell too thin to
  support a decision must say so rather than have a gate read off it.
- **All models cluster near the threshold.** Signal: 9–11% across candidates. Response: this is the
  MARGINAL branch — run TEN VAD remediation, and if it stays ambiguous, take it to the user rather
  than picking the flattering interpretation.
- **Noise suppression flattens speaker differences.** The prod constraint set enables it, and it
  reshapes timbre. Signal: EER far worse than literature at every duration. Response: re-run this
  bench over the **paired DSP-off control track recorded in Phase 7**, which separates "the model is
  wrong for Vietnamese" from "the channel destroys the signal" — two diagnoses with opposite
  responses.

  The corpus reorder changes the ordering here, and honestly weakens this diagnostic: corpus audio
  carries no browser DSP at all, so a bad Checkpoint 1 number now points at the model or the
  truncation, and cannot be blamed on the channel. That is a cleaner attribution, but it also means
  the channel's effect is unmeasured until Phase 7 runs.

## Results — Checkpoint 1 returned KILL

Run: `run_pairwise.py`, 100,044 embeddings, ~80 min. Artifacts: `results/pairwise-summary.csv`,
`results/pairwise-pairs.csv` (101,364 rows), `results/histograms/*.png`, `results/pairwise.log`.

Trial lists: 2,992 / 2,844 / 2,611 same-speaker pairs at 1s / 2s / 3s, matched by equal numbers of
non-target pairs, from 80 / 76 / 74 speakers.

EER per cell:

| model                   | clean 1s / 2s / 3s  | far-field 1s / 2s / 3s  |
| ----------------------- | ------------------- | ----------------------- |
| eres2netv2              | 20.9 / 21.1 / 19.6% | 27.4 / **23.0** / 20.7% |
| campplus                | 21.2 / 20.5 / 20.5% | 27.7 / **23.1** / 22.7% |
| wespeaker_en (baseline) | 37.0 / 31.3 / 29.6% | 36.8 / **34.8** / 33.7% |

Gate cell (far-field, 2s): best shipping candidate **eres2netv2 at 23.0%**, against a 10% PASS bar
and a 15% KILL threshold. **KILL.** Exit code 1.

### The verdict was audited before it was believed

A KILL ends the feature, so it was checked as sceptically as a suspiciously good number would be.
Two specific doubts, both testable, both tested.

**Was it the truncation window?** The screen takes each utterance's FIRST n seconds, and the plan
requires benches to cut audio the way production does — through `segment.py` — which this screen
bypassed. VoxVietnam is in-the-wild YouTube and TikTok, where clips can open with music or silence.
`scripts/probe_truncation_window.py` compared the leading window against the highest-RMS window:

- clip starts are almost all speech: the leading window is a median 4.0% quieter than the loudest
  one, and only 4.0% of clips are more than 50% quieter;
- EER moves 18.7% -> 18.4%, which is 0.3 points.

So the cut position is not the explanation. This does not retire the segmentation gap entirely — a
real speech gate would also drop non-speech _within_ a window — but it bounds it at well under a
point, against a 13-point shortfall.

**Was it the pair-construction rigour?** Sampling with no gap rule at all gives **14.3%**; the
gap>=25 rule gives 20.1% on the same subset. Channel inflation is worth **5.8 EER points**.

That is the single most useful number here. A bench that had sampled same-speaker pairs naively
would have reported 14.3% — **MARGINAL**, not KILL — and the plan would have sent us to the TEN VAD
remediation lever instead of stopping. The rigour changed the verdict. And even the inflated 14.3%
fails the 10% PASS bar, so the rule sharpened the conclusion rather than manufacturing it.

### What the distributions say

At the 2s clean cell, eres2netv2 separates same from different by +0.30 mean cosine
(0.497 +- 0.212 vs 0.197 +- 0.106). The models are not blind — they carry real speaker information.
What kills the gate is the **variance of the same-speaker distribution**: at +-0.21 its lower tail
reaches well into the non-target distribution, so no single threshold separates them cleanly.

That matters for what comes next: this is not "the embedding sees nothing", it is "the embedding is
right on average and unreliable per turn", which is precisely the regime where per-turn attribution
fails while a longer-context or enrollment-based approach could still work.

### The dead zone independently condemns the design

The plan says the dead-zone width is an OUTPUT of this phase. It came out at **0.278** at the gate
cell (tau_hi 0.472, tau_lo 0.194), and applying those thresholds to the measured distributions:

|                                  | same-speaker turns | different-speaker turns |
| -------------------------------- | ------------------ | ----------------------- |
| above tau_hi (merge)             | 42.6%              | 1.0%                    |
| inside the dead zone (undecided) | **47.4%**          | **53.6%**               |
| below tau_lo (split)             | 10.0%              | 45.4%                   |

**Coverage is 49.5%.** Phase 4's acceptance criterion requires **>=80%**.

This is a second, independent failure and it is worse than the EER. Even granting a perfect
clustering algorithm downstream, the dual-threshold mechanism the design rests on would leave
roughly half of all turns unattributed. Widening the thresholds to raise coverage is not available
either: tau_hi is already set at 1% false-accept, and loosening it is what poisons centroids.

So the design does not fail by a margin that better engineering closes. It fails on the separability
of the underlying embeddings for this language, channel and turn length.

### Honest weaknesses of this screen, stated with the verdict

Every one of these makes the screen **weaker** than planned, and none of them flatters the result:

- **Negatives are matched on nothing.** Vietnam-Celeb-H matches gender and dialect; VoxVietnam
  carries neither label. Unmatched negatives are EASIER, so the true matched-negative EER would be
  **worse** than 23.0%, not better.
- **No browser DSP anywhere.** The product's channel adds `noiseSuppression` and `autoGainControl`,
  which reshape timbre. Unmeasured until Phase 7.
- **Far-field is simulated**, stacked on already-broadcast-processed audio.
- **`segment.py` was bypassed**, bounded above at ~0.3 EER points by the probe.
- **Residual channel sharing.** Two clips 25 rows apart may still come from one video, which would
  make the true EER **worse** again.

The direction of every known bias is the same: the real number is at least this bad.

## Success Criteria

- [x] Per-pair CSV, per-cell summary CSV, and per-cell histogram PNGs written
- [x] EER reported per bucket and per distance condition, never pooled
- [x] Pair-construction rules asserted in code and demonstrably enforced
- [x] tau_hi / tau_lo derived and recorded with the false-accept / miss rates they correspond to
- [x] Gate script exits non-zero on failure
- [x] Checkpoint 1 decision recorded: **KILL**
