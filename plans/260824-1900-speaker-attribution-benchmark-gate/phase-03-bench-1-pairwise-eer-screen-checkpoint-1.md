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

**Metric:** EER over same/diff pairs, computed per duration bucket, **far-field subset only**, read
at the **2s** bucket.

- **≤10% EER for at least one model → PASS.** Select that model; carry its τ_hi/τ_lo to Phase 4.
- **10–15% → MARGINAL.** Run the remediation lever before deciding: re-cut the fixture with TEN VAD
  (`TenVadModelConfig`, already exposed in the pinned sherpa-onnx) and re-run this bench. A
  better-placed cut may recover it. If still >10%, treat as FAIL.
- **>15%, or all models fail → KILL.** Stop. Do not start Phase 4. Re-open options with the user:
  named enrollment (approach C), a longer-turn UX, or labels declared explicitly best-effort.

This screen is **necessary but not sufficient** — passing it does not imply the feature works
end-to-end. That is Phase 4's job.

## Related Code Files

- Create: `benchmarks/speaker-id/speaker_bench/pairs.py` — pair sampling with the distance/time rules enforced
- Create: `benchmarks/speaker-id/speaker_bench/metrics.py` — EER, DET points, threshold derivation
- Create: `benchmarks/speaker-id/run_pairwise.py` — the bench entrypoint + gate exit code
- Create: `benchmarks/speaker-id/results/` — CSV + PNG artifacts (gitignored)
- Read: Phase 1 fixture + turn log, Phase 2 `embed.py` / `segment.py`

## Implementation Steps

1. Segment the fixture with the Phase 2 gate replica; join segments to the turn log to get true
   speaker + distance per segment.
2. Bucket segments by **net speech** (1s / 2s / 3s), discarding those under the floor.
3. Sample pairs under the enforced rules; assert in code that no same-speaker pair violates the
   time/position constraint, and fail loudly rather than silently dropping.
4. Embed every segment once, cache the vectors; compute cosine per pair.
5. Compute EER per (model × bucket × condition); write per-pair CSV and per-cell summary CSV.
6. Emit same/diff histograms as PNG per cell — a single EER can hide a bimodal distribution, and the
   picture is what makes that visible.
7. Derive τ_hi / τ_lo from the far-field 2s cell of the selected model.
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
- **Too few valid pairs.** The ≥5-min-apart + cross-position rule is restrictive on a 25-min
  fixture. Signal: pair counts in the hundreds rather than thousands, wide EER confidence. Response:
  report the pair count beside every EER; if a cell is too thin to support a decision, say so rather
  than reading a gate off it.
- **All models cluster near the threshold.** Signal: 9–11% across candidates. Response: this is the
  MARGINAL branch — run TEN VAD remediation, and if it stays ambiguous, take it to the user rather
  than picking the flattering interpretation.
- **Noise suppression flattens speaker differences.** The prod constraint set enables it, and it
  reshapes timbre. Signal: EER far worse than literature at every duration. Response: re-run this
  bench over the **paired DSP-off control track recorded in Phase 1**, which separates "the model is
  wrong for Vietnamese" from "the channel destroys the signal" — two diagnoses with opposite
  responses. The control exists only because Phase 1 captured it; it cannot be obtained here.
