---
title: 'Speaker attribution benchmark gate'
description: 'Measure whether unknown-N speaker attribution is deliverable on web, behind a two-checkpoint kill gate, before any product code is written.'
status: pending
priority: P1
effort: '4-6d effort; elapsed gated on participant scheduling'
tags: [speaker-id, benchmark, kill-gate, local-stt]
created: 2026-08-24
---

# Speaker attribution benchmark gate

## Overview

Prove or kill per-turn speaker attribution for `apps/web` before writing product code.

The feature has an accepted contract (`plans/reports/brainstorm-260824-1833-speaker-attribution.md`)
and an advisory GO. Its load-bearing assumption — that voice embeddings separate 3–5 same-language
speakers from one far-field mic on 1–3s turns — is **unverified and unverifiable from literature**:
no Vietnamese-trained speaker model exists, and no published source covers the combined worst case
(Vietnamese + <2s + far-field + browser DSP). This plan builds the measurement that answers it.

**Nothing here ships to users.** No change to `apps/api`, `apps/web`, `packages/*`, or
`services/local-stt`. Benches live in `benchmarks/speaker-id/` as a standalone `uv` project, the
pattern `benchmarks/stt` already uses.

## Goals

| #   | Goal                                                                               | Priority |
| --- | ---------------------------------------------------------------------------------- | -------- |
| 1   | Fixture recorded through the real browser capture path, with per-turn ground truth | P1       |
| 2   | Checkpoint 1 — pairwise EER screen decides model, or kills the feature             | P1       |
| 3   | Checkpoint 2 — simulated-session bench produces the acceptance number              | P1       |
| 4   | Threshold non-stationarity measured, not assumed                                   | P1       |
| 5   | Embedding latency + CPU contention measured on the prod container                  | P2       |
| 6   | A go/no-go record that survives the session and feeds the delivery plan            | P1       |

## Phases

| #   | Phase                                                                                                                 | Status        |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | [Phase 1: Fixture acquisition and recording harness](./phase-01-fixture-acquisition-and-recording-harness.md)         | Pending       |
| 2   | [Phase 2: Bench scaffold, segmentation replica, models](./phase-02-bench-scaffold-segmentation-replica-and-models.md) | **Completed** |
| 3   | [Phase 3: Bench 1 — pairwise EER screen (Checkpoint 1)](./phase-03-bench-1-pairwise-eer-screen-checkpoint-1.md)       | Pending       |
| 4   | [Phase 4: Bench 2 — simulated session (Checkpoint 2)](./phase-04-bench-2-simulated-session-checkpoint-2.md)           | Pending       |
| 5   | [Phase 5: Bench 3 — latency and contention](./phase-05-bench-3-latency-and-contention.md)                             | **Completed** |
| 6   | [Phase 6: Gate report and go/no-go](./phase-06-gate-report-and-go-no-go.md)                                           | Pending       |

Dependencies: 1 ∥ 2 (independent) → 3 → 4 → 6; 5 depends on 2 only and may run any time after it.

Phase 1's estimate is effort, not elapsed — it depends on scheduling 3-5 participants (twice, under
the preferred protocol). Phases 2 and 5 are deliberately independent of it so work continues.

## The gate

Two checkpoints. The pairwise screen is **necessary but not sufficient** — it gates _continuation_.
Bench 2's per-turn number is the acceptance criterion.

- **Checkpoint 1 (Phase 3).** EER over same/diff pairs, per duration bucket, far-field subset only,
  at the 2s bucket. **No model ≤10% EER → stop**, re-open options (named enrollment, longer-turn UX,
  or labels declared best-effort). Marginal (10–15%) → run the TEN VAD remediation lever before
  declaring kill.
- **Checkpoint 2 (Phase 4).** Live per-turn accuracy, scored as accuracy-over-attributed with a
  ≥80% coverage floor. **Both protocols <70% → stop**, same re-open options. **Primary <70% but
  secondary ≥70% → CALIBRATION-BLOCKED** — a named third outcome meaning the algorithm works but
  the thresholds do not transfer, which goes to the user as a design question rather than a verdict.
  Expect per-turn error ≈1.5–2.5× pairwise, so passing Checkpoint 1 does not imply passing this.

Target if both pass: live 80–90%, final transcript 90–95% (3–5 same-language speakers).

## Success Criteria

- [ ] Fixture recorded through the real `getUserMedia` constraint set, with a turn log
- [ ] Benches segment with a replica of the production speech gate, never oracle cuts
- [ ] Checkpoint 1 evaluated and recorded, pass or kill
- [ ] Checkpoint 2 evaluated and recorded, pass or kill
- [ ] Both calibration protocols run (public-corpus primary, temporal-split diagnostic); the gap
      between them reported as measured threshold non-stationarity
- [ ] Every bench emits per-turn CSV, per-bucket breakdowns, and exits non-zero on gate failure
- [ ] Go/no-go record written; if GO, it names the chosen model and the calibrated τ values
- [ ] Zero changes to `apps/`, `packages/`, `services/` — verified by `git diff --stat`

## Non-goals

- Any product code: no `/embed` endpoint, no clustering in the API, no web UI. Those belong to the
  delivery plan that this gate authorizes.
- TEN VAD swap (remediation lever only — see Phase 3).
- In-turn diarization, named enrollment, cross-session memory, overlap separation.

## Inputs

- Contract + design + amendments: `plans/reports/brainstorm-260824-1833-speaker-attribution.md`
- Research: `plans/reports/research-diarization-260824-1835-speaker-attribution.md`

<!-- slug: speaker-attribution-benchmark-gate -->
