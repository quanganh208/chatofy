---
title: 'Phase 5: Bench 3 — latency and contention'
status: completed
phase: 5
priority: P2
effort: '0.5-1d'
dependencies: [2]
---

# Phase 5: Bench 3 — latency and contention

## Overview

Measure embedding extraction cost per candidate model on production hardware, and verify the
load-bearing latency claim: that embedding can hide inside the translation window rather than adding
to the turn.

Depends only on Phase 2 — may run while the fixture is being recorded.

## Requirements

**Functional**

- [x] Embedding wall time per model, per input duration, on the prod container's CPU
- [x] Cost measured both idle and while an STT recognizer is running concurrently
- [x] The parallel-dispatch assumption validated or refuted

**Non-functional**

- [x] No product code, and no changes to the running sidecar

## Architecture

**The claim being tested.** The design says embedding runs concurrent with translation and therefore
costs ~0 at p50. That rests on two things:

1. Translation is a _network_ call to Gemini (p50 723ms), so the CPU is idle during it.
2. Embedding is dispatched separately (`POST /embed`) rather than piggybacked on `/transcribe` —
   piggybacking would put it before translation can start, making it serial.

Point 2 is a design decision already recorded. Point 1 is measurable now, and point 1 is where the
assumption could quietly fail: **the CPU is only idle for _this_ session**. With concurrent users,
another session's STT is running and both recognizers ask ONNX Runtime for threads on the same box.

**Correction found while implementing: the thread count is 4 in production, not 8.**
`docker-compose.prod.yml:209` sets `LOCAL_STT_THREADS` to `${PROD_LOCAL_STT_THREADS:-4}`, and the
running prod container confirms `LOCAL_STT_THREADS=4`. Only _dev_ uses 8
(`docker-compose.yml:66`). This plan, and the design note it came from, assumed 8 everywhere. On an
8-physical-core host (16 logical) that is the difference between the extractor competing for the
whole machine and competing for half of it, so **both counts are measured** rather than picking one.

Also checked: the sidecar container has **no CPU limit** — `NanoCpus=0`, no cpuset, only a 4GB
memory cap. So container and host see the same CPU, which is what makes a host run comparable at
all; the remaining difference is the ONNX Runtime build, and the pins are byte-identical.

So measure two conditions, not one:

- **Idle**: embedding alone. This is the single-user number.
- **Contended at STT threads = 4**: production's real configuration.
- **Contended at STT threads = 8**: dev's, and the configuration the design note assumed.

The contending workload is a **real Moonshine recognizer decoding in a loop**, built exactly as
`services/local-stt/engines/moonshine_en.py` builds it. A synthetic busy-loop would contend for
cores but not for ONNX Runtime's thread pools or memory bandwidth, which is the part that decides
this.

Also measure the effect of `num_threads` 1, 2, and 8 on the extractor. The design specifies 1-2
precisely to avoid oversubscription, and that choice should rest on a measurement rather than on
reasoning.

**No endpoint is added here.** `/embed` is product code and belongs to the post-gate delivery. This
bench drives `SpeakerEmbeddingExtractor` directly, in the same container image and on the same CPU,
which is what the number depends on.

## Related Code Files

- Create: `benchmarks/speaker-id/run_latency.py` — timing harness, both conditions
- Create: `benchmarks/speaker-id/results/latency-*.csv`
- Read (do not modify): `services/local-stt/engines/base.py`, `services/local-stt/app.py`

## Implementation Steps

1. Time embedding over 1s / 2s / 3s / 5s inputs, per model, many repetitions; report p50 and p95,
   discarding the first call (model warm-up).
2. Repeat with `num_threads` set to 1, 2, and 8 on the extractor.
3. Repeat the whole matrix under contention: an STT recognizer decoding continuously on the same box.
4. Run inside the prod container image so the CPU, thread env (`LOCAL_STT_THREADS`, and the
   OMP/MKL vars set at import in `app.py`) and ONNX Runtime all match production.
5. Compare against the sanity-check ballpark from the brainstorm record — CAM++ ~30–100ms,
   ERes2NetV2 ~150–500ms per 3s turn. Those are unverified estimates; the measurement replaces them.
6. Run the **full matrix across all candidate models**, so this phase never waits on Phase 3's
   selection. The per-model verdict — does embedding fit inside the 723ms translation window, idle
   and contended — is stated for every candidate here, and Phase 6 reads off the one Phase 3 chose.

## Success Criteria

- [x] p50/p95 embedding time per model x duration x thread count, idle and contended
- [x] CSV artifacts written
- [x] Recommended `num_threads` for the extractor, backed by the measurement
- [x] Explicit verdict per candidate model on whether the delta≈0 constraint holds, in both conditions
- [x] If it does not hold contended, the concurrency ceiling at which it breaks is stated

## Model-choice decision rule — written BEFORE Phase 3's accuracy numbers exist

Phase 5 makes the model choice a real trade-off with numbers on one side. Phase 3 will put numbers
on the other. The rule is recorded now, deliberately, so the choice cannot be rationalised after the
accuracy results are visible.

**campplus is the operational default.** It is 4-10x cheaper than eres2netv2 at every measured cell,
which buys multi-session headroom, removes the dev-parity marginality entirely, and shrinks the
`/embed` tail.

**eres2netv2 displaces it only if Phase 3/4 shows an accuracy advantage large enough to change live
attribution outcomes**, quantified in advance as EITHER:

- **>= 20% relative EER improvement** on the far-field 2s bucket (the Checkpoint 1 cell), OR
- a materially lower misattribution rate in Bench 2's simulated session — i.e. the per-turn accuracy
  gap exceeds the run-to-run spread across the randomised sequences.

If neither holds, ship campplus regardless of which model scores nominally higher. A model that is
better by a margin smaller than the measurement's own noise is not better.

Phase 6 reads this rule off rather than re-litigating it.

## Risk Assessment

- **Contended cost is much worse than idle.** Signal: contended p95 exceeds the translation window.
  Response: this does not kill the feature — it bounds concurrent sessions, or argues for a smaller
  model. Report it as a capacity constraint for the delivery plan rather than a gate failure.
- **Benchmarking outside the container gives the wrong number.** Signal: results that do not
  reproduce inside it. Response: only the in-container number counts; the host has a different
  thread environment.
- **In-container setup fights back.** Signal: the image resists running an ad-hoc script. Response:
  budget for it — this is why the estimate is 0.5-1d rather than 0.5d.
- **Warm-up pollutes p50.** Signal: first call orders of magnitude slower. Response: discard warm-up
  explicitly and say so in the artifact, rather than letting it inflate the median.
- **A thin fit read as a clean pass.** At `REPS=12` a "p95" is the second-worst of twelve samples,
  and contended cells move run to run — the same eres2netv2 stt8 cell measured 333ms on the host and
  522ms in the container, a 57% spread. Response: the verdict reports anything under 30% headroom as
  MARGINAL rather than FITS, and the gate judges only the recommended configuration under the
  production condition. Before relying on a marginal cell, re-measure it with more repetitions.

  **RESOLVED.** Re-measured at `REPS=50` with a nearest-rank p95. The marginal cell that prompted
  this (eres2netv2, dev-parity threads, one decode) moved from 11% to 37% headroom — that risk was
  an artifact of the estimator, not a real tail. A genuine MARGINAL appeared elsewhere: eres2netv2
  at the two-decode ceiling, 28%.

- **Measuring a thread environment production does not have.** The sidecar sets OMP/MKL at import
  (`app.py:16-18`) before ONNX Runtime sizes its pool; a bench invoked as plain `python` bypasses
  that. Signal: the run prints `OMP_NUM_THREADS: (unset)`. Response: the script warns on stderr, and
  the documented docker command passes the variables explicitly.
- **Multi-session ceiling unmeasured.** Contention is exactly ONE concurrent STT recognizer, while
  production may serve several sessions. Acceptance criterion 5 is therefore SCOPED, not satisfied —
  the verdict says so in its own output. Cheapest honest closure, once Phase 3 picks a model: one
  extra run with two concurrent `SttLoad(threads=4)` instances, chosen model only, threads=2,
  turns <=3s. Roughly ten minutes; do it then, not now for all three candidates.

  **RESOLVED.** The extra run was done immediately rather than deferred, and for all three
  candidates rather than one — the matrix is cheap and waiting on Phase 3 would have left the
  criterion open through two more phases. See Results: criterion 5 is met, and it fired. The
  verdict now prints `CONCURRENCY CEILING: measured up to 2 concurrent STT decodes` instead of
  `NOT ESTABLISHED`.

## Results

Two authoritative runs, both inside the prod image (`chatofy_prod-local-stt`) with
`LOCAL_STT_THREADS=4`, `OMP_NUM_THREADS=4`, `MKL_NUM_THREADS=4` passed explicitly, `REPS=50`,
3 warm-up calls discarded, p95 by nearest rank.

- `results/latency-container.csv` / `.log` — 1 concurrent STT decode
- `results/latency-container-2decode.csv` / `.log` — 2 concurrent decodes, the architectural ceiling

Gate cells only (extractor `num_threads=2`, turns <=3s). Headroom is against the 723ms window.

| Model        | idle          | contended STT=4, 1 decode | contended STT=4, 2 decodes (ceiling) | contended STT=8, 2 decodes (dev diag) |
| ------------ | ------------- | ------------------------- | ------------------------------------ | ------------------------------------- |
| campplus     | 24.9ms (97%)  | 35.3ms (95%) FITS         | 132.2ms (82%) FITS                   | 183.5ms (75%) FITS                    |
| eres2netv2   | 160.1ms (78%) | 268.2ms (63%) FITS        | **517.0ms (28%) MARGINAL**           | **895.3ms (-24%) EXCEEDS**            |
| wespeaker_en | 25.6ms (96%)  | 40.7ms (94%) FITS         | 136.6ms (81%) FITS                   | 191.3ms (74%) FITS                    |

**Acceptance criterion 5 is now closed, and it fired.** The concurrency ceiling is 2 concurrent
decodes — not a tunable, an architectural fact: `services/local-stt/engines/registry.py` registers
exactly two engines (`vi`, `en`), each holding its own lock across a decode, so no number of sessions
pushes it higher. Measured there, **eres2netv2 is the one candidate that breaks**: MARGINAL at
production's thread count and outright EXCEEDS at dev's. The two cheap models keep over 80% headroom
at the same point. `delta ~= 0` holds for campplus and wespeaker_en at full architectural load, and
does not hold for eres2netv2.

This is the first hard number on the model-choice rule above, and it points the same way the rule
already did — before any accuracy data existed.

**M7 ballpark comparison (step 5).** The brainstorm record estimated CAM++ ~30-100ms and ERes2NetV2
~150-500ms per 3s turn. At one decode both land inside their bands (35.3ms, 268.2ms), so the
estimates were sound for the single-session case. At the ceiling both overshoot — campplus 132.2ms
(~32% above the band's top), eres2netv2 517.0ms (~3% above). The ballpark was implicitly a
single-session figure; it should not be quoted as a capacity number.

**Thread recommendation is stable at one decode and not at two.** At one decode `num_threads=2` won
every model under contention, and 8 only when idle. At the ceiling the winner scrambles per cell
(8 / 1 / 8 / 1 / 2 / 8 ...) because the between-thread spread collapses below run-to-run noise once
8 of 16 logical cores are held by STT. The gate therefore holds `num_threads=2` fixed rather than
reading a winner off noise. Since thr=2 clears the window with >80% headroom for both cheap models at
the ceiling, the ambiguity does not change any verdict — but the recommendation should be stated as
"1-2, and do not tune it against a contended measurement", not as a precise optimum.

**Verified with:** `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` -> 127 passed, 0 skipped.
Harness tests are mutation-checked: 5/5 injected mutants killed.

**Scope note.** No product code changed; `git status` shows the work confined to
`benchmarks/speaker-id/` and `plans/`.
