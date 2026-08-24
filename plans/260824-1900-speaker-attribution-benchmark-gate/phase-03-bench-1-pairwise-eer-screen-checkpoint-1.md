---
title: 'Phase 3: Bench 1 — pairwise EER screen (Checkpoint 1)'
status: todo
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

**Metric:** EER over the corpus trial lists, computed per duration bucket, on the **hard list**
(Vietnam-Celeb-H, negatives matched on gender AND dialect), read at the **2s** bucket.

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

## Related Code Files

- Create: `benchmarks/speaker-id/run_pairwise.py` — the bench entrypoint + gate exit code
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
