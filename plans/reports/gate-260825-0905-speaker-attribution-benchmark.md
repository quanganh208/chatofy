# Gate report — speaker attribution benchmark

**Date:** 2026-08-25
**Plan:** `plans/260824-1900-speaker-attribution-benchmark-gate/`
**Branch:** `bench/speaker-id-latency-gate`
**Verdict:** **Checkpoint 1 KILL for the planned design. A different design measured PASS.**

## The one-line version

Per-turn speaker attribution **without enrollment** does not work for Vietnamese at 2s turns:
23.0% EER against a 10% bar, and a dead zone that leaves half of all turns unlabelled.
The **same models with a 15s named enrollment** hit **87.1% accuracy over the most confident 80%**
of turns on the hardest cell — against a 70% bar. The feature is not impossible; the
threshold-clustering approach is.

## What was measured

- **Corpus:** VoxVietnam test split (HF `hustep-lab/VoxVietnam-Dataset`, `cc-by-nc-4.0`, gated).
  26,523 clips, 4.3GB, in-the-wild YouTube/TikTok Vietnamese. 76 speakers reach the gate cell.
- **Models:** eres2netv2 (192d, Mandarin), campplus (192d, zh+en), wespeaker_en (512d, VoxCeleb —
  baseline only, never a shipping candidate).
- **Conditions:** clean, and simulated far-field (pyroomacoustics image-source, 2.00m, measured
  RT60 0.507s, 15dB SNR).
- **Turn lengths:** 1s / 2s / 3s for the screen; 2s / 5s for the enrollment probe.

## Checkpoint 1 — pairwise EER screen: KILL

Gate cell is far-field @ 2s. PASS ≤10%, MARGINAL 10–15%, KILL >15%.

| model        | clean 1s / 2s / 3s  | far-field 1s / 2s / 3s  |
| ------------ | ------------------- | ----------------------- |
| eres2netv2   | 20.9 / 21.1 / 19.6% | 27.4 / **23.0** / 20.7% |
| campplus     | 21.2 / 20.5 / 20.5% | 27.7 / **23.1** / 22.7% |
| wespeaker_en | 37.0 / 31.3 / 29.6% | 36.8 / 34.8 / 33.7%     |

100,044 embeddings, ~80 min. Exit code 1. Artifacts: `results/pairwise-summary.csv` (18 cells),
`results/pairwise-pairs.csv` (101,364 rows), `results/histograms/*.png`.

### The dead zone condemns it harder than the EER

Dead-zone width is an OUTPUT of the phase, not an input. It came out at **0.278**
(τ_hi 0.472 at 1% false-accept, τ_lo 0.194 at 10% miss):

|                                  | same-speaker turns | different-speaker turns |
| -------------------------------- | ------------------ | ----------------------- |
| above τ_hi (merge)               | 42.6%              | 1.0%                    |
| inside the dead zone (undecided) | **47.4%**          | **53.6%**               |
| below τ_lo (split)               | 10.0%              | 45.4%                   |

**Coverage 49.5%** against Phase 4's ≥80% floor. Even granting a perfect downstream clusterer, half
of all turns stay unattributed. Widening τ_hi is not available — it already sits at 1% false-accept,
and loosening it is what poisons centroids.

### Two audits ran before the verdict was reported

- **Truncation window is not the cause.** Clip starts are median 4.0% quieter than the loudest
  window; only 4.0% are >50% quieter. Embedding the loudest window instead of the first moves EER
  18.7% → 18.4% — **0.3 points against a 13-point shortfall**.
- **Pair rigour is material, and it changed the verdict.** No gap rule → **14.3%**; the measured
  `MIN_INDEX_GAP=25` rule → 20.1% on the same subset. Channel inflation is worth **5.8 EER points**.
  A naive bench would have reported MARGINAL and sent us to the TEN VAD remediation lever instead of
  stopping. The inflated number still fails the 10% bar, so the rule sharpened the conclusion rather
  than manufacturing it.

### Why it fails — and why that mattered for what came next

At the 2s clean cell eres2netv2 separates same from different by **+0.30 mean cosine**
(0.497 ± 0.212 vs 0.197 ± 0.106). The models are not blind. What kills the gate is the **±0.21
same-speaker spread**, whose lower tail reaches into the non-target distribution.

"Right on average, unreliable per turn" is precisely the regime where averaging over an enrollment
set can rescue what a single-turn threshold cannot. That is why the KILL was not reported as the end
of the question.

## The re-opened options, measured

`scripts/probe_enrollment_identification.py`, same corpus, same room, same channel-gap rule
(enrollment clips ≥25 rows before any test clip, so no centroid shares a source recording with its
test turn). 75 speakers enrollable from 3 clips of ≤5s each (≤15s per person). Scored as top-1
identification among N known speakers, and again over the most confident 80% of turns — Phase 4's
own acceptance shape (≥70% accuracy at ≥80% coverage).

| model      | condition | turn | N=3 top-1 / @80% cov | N=5 top-1 / @80% cov |
| ---------- | --------- | ---- | -------------------- | -------------------- |
| eres2netv2 | clean     | 2s   | 86.7% / 96.3%        | 82.8% / 94.3%        |
| eres2netv2 | far-field | 2s   | 84.7% / 92.8%        | **80.0% / 88.3%**    |
| eres2netv2 | far-field | 5s   | 84.8% / 93.1%        | 81.6% / 91.5%        |
| campplus   | clean     | 2s   | 87.3% / 96.4%        | 83.3% / 93.8%        |
| campplus   | far-field | 2s   | 84.4% / 91.2%        | **79.0% / 87.1%**    |
| campplus   | far-field | 5s   | 83.8% / 92.1%        | 80.5% / 88.9%        |

Chance is 33.3% (N=3) and 20.0% (N=5). Every cell PASSes the 70% bar; the hardest cell clears it by
17 points. Artifact: `results/enrollment-summary.csv`.

**The longer-turn option is separately answered, and it is nearly worthless.** Going 2s → 5s on the
hardest cell buys **1.6 points** (80.0% → 81.6%). The screen said the same thing without enrollment:
1s → 3s only moved 27.4% → 20.7%. The win comes from enrollment, not from turn length. A UX that
asks people to speak longer would cost real usability for almost nothing.

## Cross-cutting with Phase 5 — the model choice is decided by latency, not accuracy

Gate cells, extractor `num_threads=2`, headroom against the 723ms translation window:

| Model        | idle          | STT=4, 1 decode    | STT=4, 2 decodes (architectural ceiling) |
| ------------ | ------------- | ------------------ | ---------------------------------------- |
| campplus     | 24.9ms (97%)  | 35.3ms (95%) FITS  | 132.2ms (82%) FITS                       |
| eres2netv2   | 160.1ms (78%) | 268.2ms (63%) FITS | **517.0ms (28%) MARGINAL**               |
| wespeaker_en | 25.6ms (96%)  | 40.7ms (94%) FITS  | 136.6ms (81%) FITS                       |

The 2-decode ceiling is not a tunable: `services/local-stt/engines/registry.py` registers exactly
two engines (`vi`, `en`), each holding its own lock across a decode.

**eres2netv2 buys 1.2 accuracy points at the hardest enrollment cell (88.3% vs 87.1%, inside noise)
and breaks the latency ceiling. campplus is ~4× cheaper and keeps 82% headroom at full
architectural load.** If enrollment is chosen, **campplus is the model** — and that conclusion is
driven by Phase 5, with the accuracy difference too small to argue against it.

## What was NOT measured

Every one of these makes the numbers **weaker** than a production claim, and none of them flatters
the result:

- **Closed set only.** Nobody unenrolled ever speaks in the enrollment probe. A guest who skipped
  enrollment is currently forced onto somebody else's centroid. A rejection threshold for unknown
  speakers is **unmeasured** and is the largest open risk in the enrollment design.
- **No browser DSP anywhere.** The product channel adds `noiseSuppression` and `autoGainControl`,
  which reshape timbre. Phase 7 exists to measure this and has not run.
- **Far-field is simulated**, stacked on already-broadcast-processed audio.
- **Negatives matched on nothing.** VoxVietnam carries no gender or dialect labels. Unmatched
  negatives are EASIER, so a matched-negative number would be worse.
- **`segment.py` was bypassed.** Bounded above at ~0.3 EER points by the truncation probe, but the
  production speech gate would also drop non-speech _within_ a window.
- **Residual channel sharing.** Two clips 25 rows apart may still come from one long video.
- **End-to-end turn latency delta** — Phase 5 measures extractor cost idle and contended, a proxy.
  The real path needs the `/embed` endpoint, which is product code this gate exists to authorize.
  **This acceptance item is deferred, not met.**
- **Multi-session capacity.** Contention was measured to the 2-decode architectural ceiling only.

## Open questions from the brainstorm record, revisited

1. **arXiv 2606.08505 streaming diarization** — still unread. Given enrollment clears the bar, the
   marginal value of pursuing it is low; revisit only if the unknown-speaker rejection problem
   proves hard.
2. **VoxCeleb→Vietnamese cold EER** had no citation, only a proxy. **Now measured:** wespeaker_en at
   34.8% far-field 2s, vs 23.0% for the Mandarin-trained models. The disagreement between the two
   advisory opinions is resolved — VoxCeleb-only models are materially worse for Vietnamese, but the
   in-domain models are not good enough either without enrollment.
3. **Per-model embedding dimensions** — confirmed in Phase 2 (192 / 192 / 512, read off the loaded
   extractor).
4. **The combined worst case (VN + <2s + far-field)** had no published source. This report is now
   that source, for this setup.
5. **Re-cluster cadence** — Phase 4 was to output this. Not applicable if enrollment replaces
   clustering; a new question ("when to re-average a centroid from accepted turns") takes its place.
6. **Whether the 2-session recording happened** — it did not, and under the reordered plan it never
   needed to for the kill decision. Still required before any production claim.

## Status of the plan

| Phase                                          | Status                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| 1 Corpus acquisition and trial harness         | In progress — Vietnam-Celeb absent, licence unstated (non-blocking) |
| 2 Bench scaffold, segmentation replica, models | Completed                                                           |
| 3 Bench 1 — pairwise EER screen (Checkpoint 1) | **Completed — KILL**                                                |
| 4 Bench 2 — simulated session (Checkpoint 2)   | **Not started, and must not be** — it benches the killed design     |
| 5 Bench 3 — latency and contention             | Completed                                                           |
| 6 Gate report and go/no-go                     | This document                                                       |
| 7 Browser-DSP channel delta                    | Not started — now the highest-value remaining measurement           |

Scope: `git diff --stat` confirms zero changes to `apps/`, `packages/`, `services/`.

## Decision required from the user

The plan's kill clause says the options go to the user and that this report does not pick. What the
measurements changed is that they are no longer equally plausible:

- **Named enrollment (approach C)** — measured PASS, 87.1% at 80% coverage on the hardest cell with
  campplus. Costs: an enrollment step in the UX, consent and storage obligations for voice
  templates, and an unmeasured unknown-speaker rejection problem.
- **Longer-turn UX** — measured, and buys 1.6 points. Not viable on its own.
- **Best-effort labels with the original design** — 49.5% coverage, so roughly half of turns carry
  no label at all. This is what "best-effort" would actually mean here.
- **Abandon per-turn attribution.**

## Unresolved questions

- Does an unknown (unenrolled) speaker get rejected reliably? Unmeasured, and the main risk to the
  enrollment design.
- What does browser DSP (`noiseSuppression`, `autoGainControl`) do to the enrollment centroid, given
  enrollment and turns pass through the same processing? Phase 7.
- Is a 15s enrollment the right budget? 3×5s was chosen as a plausible product ask, not swept.
- Voice templates are biometric data. What retention and consent model applies?
- Vietnam-Celeb's licence is unstated; the corpus was never downloaded. VoxVietnam is `cc-by-nc-4.0`
  — non-commercial. Fine for benchmarking; **not** a basis for shipping anything trained on it.
