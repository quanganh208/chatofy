---
title: 'Phase 4: Bench 2 — simulated session (Checkpoint 2)'
status: todo
phase: 4
priority: P1
effort: '2d'
dependencies: [3]
---

# Phase 4: Bench 2 — simulated session (Checkpoint 2)

## Overview

Run the actual online clustering algorithm over realistic turn sequences and measure what a user
would experience: per-turn attribution accuracy live, accuracy after the deferred re-cluster, and
speaker-count error. This produces the acceptance number.

Runs only if Checkpoint 1 passed.

## Requirements

**Functional**

- [ ] Faithful implementation of the designed online algorithm (dual threshold, dead zone,
      duration-weighted centroids, merge pass, per-language namespace, short-turn ladder)
- [ ] Deferred re-cluster (AHC + Hungarian remap) implemented and measured separately from live
- [ ] Both calibration protocols run; the gap between them reported
- [ ] Speaker-count trajectory over the session
- [ ] Gate script exits non-zero when Checkpoint 2 fails

**Non-functional**

- [ ] This is bench code, not product code — but it is the reference the delivery implementation
      must match, so keep it readable and behaviour-explicit

## Architecture

**The algorithm under test** (from the accepted design):

- L2-normalized embeddings, cosine against per-speaker centroids.
- `≥ τ_hi` → assign + update centroid. `< τ_lo` → mint. Between → assign provisionally,
  low-confidence, **do not update the centroid**.
- Centroid = duration-weighted running mean (store sum + count); only high-confidence turns with
  ≥2s net speech update it.
- Merge pass after each mint and every ~10 turns: centroids above τ_merge merge and remap.
- **Per-language namespace** — vi turns cluster only against vi centroids. A bilingual person
  becomes two ids; accepted and documented.
- **Short-turn ladder** by net speech: `<1.0s` never mints, never updates, assigns only at
  `≥ τ_hi`, else `unknown`. `1–2s` assigns by threshold, no centroid update. `≥2s` full
  participation.
- Speaker cap 8; a new speaker is tentative until it has 2 confirmed turns. (Both rules are recorded
  in the contract — the bench is the reference the delivery must match, so it must not exceed it.)
- **Deferred re-cluster**: every ~20 turns and at session end, full AHC over stored turn embeddings,
  Hungarian map back to display ids. This uses _relative_ distances within one channel and is the
  accuracy backstop, not polish — it is where the 90–95% band comes from.

**Anti-circularity — run both protocols, report both.** Deriving thresholds from the same fixture
the bench then evaluates on is fitting and testing on the same data.

- **Primary (deployment-honest).** Calibrate τ on **public corpora** — VIVOS for vi, LibriSpeech
  for en — then evaluate on the self-recorded fixture, fully held out. This is the production
  condition: thresholds fixed a priori, the user's room unseen. VIVOS is close-talk read speech, so
  the domain shift is the test rather than a defect.
- **Secondary (diagnostic upper bound).** Temporal split of the fixture: calibrate on the first
  ~40%, evaluate on the rest. Optimistic relative to deployment, but bounds what adaptive thresholds
  could achieve.
- **The gap between the two is the measured threshold non-stationarity** — risk #1 turned into a
  number. Report it explicitly; it also says how much load the deferred re-cluster is carrying.

If Phase 1 produced two recording sessions, prefer calibrate-on-session-1 / evaluate-on-session-2 as
the secondary protocol — a genuine session-level split beats a temporal one. Speaker-disjoint splits
are impossible with 3–5 people; do not pretend otherwise.

**Turn sequences.** Sample turn order and lengths from the measured turn-length histogram of the
fixture, not from a uniform guess. Run many randomized sequences and report a distribution, not one
run — a single ordering can flatter or punish a clustering algorithm by luck of who spoke first.

## Scoring protocol — pre-declared, not decided while reading the number

Every item here can swing the gate by several points, so each is fixed now.

- **Cluster-to-truth mapping.** Hungarian assignment over the **full sequence**, computed once at
  the end, then applied retroactively to score each live decision. Not greedy first-binding, not
  per-prefix. This is the standard diarization-eval choice and it keeps live and post-re-cluster
  numbers scored the same way.
- **How `unknown` counts.** The contract mandates `unknown` below 1s net speech, so it must not be
  scoreable in a way that rewards hiding. Report all three: **coverage** (fraction of turns
  attributed), **accuracy-over-attributed**, and **strict accuracy** (unknown counts wrong).
  **The gate reads accuracy-over-attributed, subject to a coverage floor of ≥80%.** Together those
  block both games: emitting `unknown` everywhere fails the floor, and guessing on everything fails
  accuracy.
- **τ_merge derivation.** Not inherited from Phase 3, which only derives τ_hi/τ_lo. Derive it from
  the same-speaker cross-position distribution on the calibration corpora, and additionally sweep it
  in the secondary protocol, reporting sensitivity.
- **N = 50–100 randomized sequences.** Report the distribution, not a single run.
- **How calibration corpora get segmented.** The same speech-gate replica and the same net-speech
  bucketing as the fixture, with the same pair rules **minus the cross-position constraint** —
  VIVOS and LibriSpeech carry no distance labels. Do not substitute fixed-length slicing; the whole
  point is that segmentation matches production.

## Checkpoint 2 — the gate

**Metric:** live per-turn attribution accuracy on the **primary (deployment-honest)** protocol.

- **≥80% → PASS**, inside the agreed band. Record the final-transcript number too.
- **70–80% → PASS WITH CONCERN.** Below the agreed band but above the floor; take the numbers to the
  user along with the re-cluster gap before proceeding to delivery.
- **<70% after threshold tuning → KILL.** Stop, re-open options with the user (named enrollment,
  longer-turn UX, best-effort labels).

Expect live per-turn error ~1.5–2.5× the Phase 3 pairwise EER. If it lands far outside that ratio,
something is wrong in the harness — investigate before reading the gate.

## Related Code Files

- Create: `benchmarks/speaker-id/speaker_bench/cluster_online.py` — the leader-follower algorithm
- Create: `benchmarks/speaker-id/speaker_bench/recluster.py` — AHC + Hungarian remap
- Create: `benchmarks/speaker-id/speaker_bench/sessions.py` — turn-sequence sampling from the histogram
- Create: `benchmarks/speaker-id/run_session.py` — bench entrypoint + gate exit code
- Read: Phase 3 τ values and cached embeddings

## Implementation Steps

1. Implement `cluster_online.py` exactly as specified above; unit-test the dead zone, the short-turn
   ladder, and the merge pass on synthetic vectors where the right answer is known.
2. Implement `recluster.py`; unit-test that Hungarian remapping preserves display-id continuity.
3. Build the turn-length histogram from the fixture; implement sequence sampling from it.
4. Calibrate τ on public corpora (primary protocol) — reuse Phase 3's machinery against VIVOS +
   LibriSpeech rather than the self-recorded fixture.
5. Run N = 50–100 randomized sequences under the primary protocol; record per-turn CSV
   (`turn id, bucket, net speech ms, true speaker, assigned, confidence margin, phase`) for each.
6. Run the secondary protocol (session split if available, else temporal 40/60); record the same.
7. Compute and report under the pre-declared scoring protocol: coverage, accuracy-over-attributed,
   strict accuracy, post-re-cluster accuracy, speaker-count trajectory (minted vs true over time),
   and per-bucket breakdowns.
8. Report the primary-vs-secondary gap as threshold non-stationarity.
9. Implement the gate: exit non-zero below 70%; print the decision and the numbers.
10. Record what re-cluster cadence actually helped — the ~20-turn figure is a guess and should be an
    output of this phase, not a fixed input.

## Success Criteria

- [ ] Online algorithm unit-tested on synthetic vectors with known answers
- [ ] Both calibration protocols run; both numbers reported
- [ ] Coverage, accuracy-over-attributed, and strict accuracy all reported; the gate reads
      accuracy-over-attributed with the ≥80% coverage floor applied
- [ ] τ_merge derived and its sensitivity swept
- [ ] Threshold non-stationarity gap reported explicitly
- [ ] Live and post-re-cluster accuracy reported, per duration bucket
- [ ] Speaker-count trajectory reported (minted vs true, over time)
- [ ] Per-turn CSV written for every run
- [ ] Distribution across randomized sequences reported, not a single run
- [ ] Gate exits non-zero below 70% on both protocols; CALIBRATION-BLOCKED reported distinctly
- [ ] Re-cluster cadence recommendation derived from measurement
- [ ] Checkpoint 2 decision recorded

## Risk Assessment

- **Harness flatters the algorithm.** Signal: live accuracy far above the 1.5–2.5× pairwise
  expectation. Response: suspect the harness — most likely the evaluation is reusing calibration
  data, or sequences are too short for cold start to bite. Verify before believing.
- **Cold start dominates on short sessions.** The first turn of each speaker is unverifiable by
  definition, so a 20-turn sequence with 5 speakers spends a quarter of its turns on cold start.
  Signal: accuracy strongly dependent on sequence length. Response: report accuracy against sequence
  position, and state the cold-start share separately rather than letting it silently set the number.
- **Speaker collapse or double-minting hides inside an accuracy average.** Signal: acceptable
  accuracy with a bad count trajectory. Response: the count trajectory is a first-class result — a
  run that scores 85% while minting 9 speakers for 4 people has not passed anything.
- **Primary protocol fails purely from domain shift.** VIVOS is close-talk read speech. Signal:
  primary far below secondary. Response: that gap _is_ the measurement, not a failure of the
  protocol — it says thresholds cannot be set a priori and the delivery must lean on the re-cluster
  (or on a short in-session calibration, which would be a new design question for the user).
