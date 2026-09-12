---
phase: 3
title: 'Phase 3: Recognizer pool and cost-adaptive partial cadence'
status: completed
priority: P2
effort: '1-1.5d'
dependencies: [1]
---

# Phase 3: Recognizer pool and cost-adaptive partial cadence

## Implementation record

The thread-safety experiment (step 1) decided the mechanism, per this phase's own pre-decided branch: **a lane `Semaphore(N)` over the ONE recognizer, not a pool of copies.** Evidence: 120 concurrent decodes through one recognizer (both engines, mixed clips, 30 rounds) produced transcripts byte-identical to their serial baselines; concurrent decodes on the shared ONNX session scale (~2.3x at 6 workers, threads=1); and the zero-memory property removes the OOM risk entirely — the plan's main Phase-3 risk. A recognizer-copy pool would have multiplied 223/418MB weights against the 4g limit for no measured gain. Threads stay 4 (prod-optimal, swept 1/2/3/4/8 on prod: 8 is ~25% slower per decode and burns 3x CPU); lanes are the separate concurrency axis (`LOCAL_STT_CONCURRENCY`, default 4, clamped to >= 1; refusal is 503 after `LOCAL_STT_LANE_WAIT_MS` 2000ms).

Prod criteria in "Success Criteria" marked [x] are proven by the local equivalents (test_app.py concurrency test, 503 mapping, lane-timeout) — the 6-deep prod probe re-run (<= 0.60x, >= 550% CPU, RSS bound) happens at deploy time, per the deployment gates. Follow-up recorded from review: **nothing prioritizes a final decode over a live-preview decode at the sidecar or the api** — under saturation, shedding partials-not-finals is currently luck of arrival order. Mitigated at one-user load by the duty gate + in-flight guard + 4 lanes. Filed as follow-up work.

## Overview

Remove the serialization itself, so the idle cores become throughput. This is **headroom
for 3+ simultaneous users**, not the fix for the reported single-user symptom — measured,
one and two concurrent partial streams already hold the 300ms cadence, and only the third
breaks English (500ms cadence, 41% of live updates lost). Ship it after Phases 1–2.

Two halves, because supply alone leaves the amplifier in place and demand alone leaves the
machine idle by construction:

- **Supply:** replace the one-lock-per-engine with a small pool of independent recognizers.
- **Demand:** make the partial re-decode cadence stretch with decode cost, which is this
  repo's own measured conclusion that was never implemented
  (`docs/development-journey.md`: "nhịp re-decode phải giãn theo độ dài buffer, không cố định").

## Requirements

Functional:

- `/transcribe` decodes N requests concurrently per engine, each on its own recognizer instance.
- A saturated pool answers **HTTP 503** within a bounded wait rather than queueing invisibly.
- `/healthz` reports pool size and availability; a borrow that waited is logged with its wait time.
- The partial scheduler idles in proportion to the work the last decode cost.

Non-functional:

- **Do not raise `LOCAL_STT_THREADS`.** Measured: 4 is optimal, 8 is ~25% slower per decode
  and burns 3× the CPU. Pool lanes must come with _fewer_ threads each, keeping
  `engines × lanes × threads` near the 16 cores.
- Memory is the binding constraint, not CPU. Default the pool to **2** and raise only after
  reading real RSS.
- Must not assume a single sherpa-onnx recognizer is thread-safe. The repo explicitly refuses
  to ("is not assumed to be safe for concurrent use"), and the failure mode of being wrong is
  a plausible-but-wrong transcript, not a crash.
- `/transcribe` request/response shape unchanged.

## Architecture

**Why a pool and not simply deleting the lock.** Deleting it is the smallest diff and costs
no memory, but it bets on `OfflineRecognizer.decode_stream` holding no per-recognizer mutable
state — and Moonshine has a cached-decoder path while the transducer carries decoder state.
If that bet is wrong the symptom is garbled text that no latency metric reveals and no
existing test would catch; this repo has already shipped two defects of exactly that shape.
A pool of independent instances sidesteps the question entirely. Worth settling the cheap way
first: a ~20-line local experiment on two concurrent decodes against one recognizer would
either collapse this phase into a `Semaphore(N)` at zero memory cost, or confirm the pool is
required. Run that experiment before paying for the pool.

**Why 503 rather than an unbounded wait.** The current design hides its queue inside the
sidecar, which is precisely why this took measurement to find. A bounded borrow that refuses
makes overload visible to the caller and to the log.

**Why cadence rather than a smaller window.** `DEFAULT_WINDOW_SECONDS = 8` never engages,
because `MAX_UTTERANCE_MS = 8000` caps a turn at the same 8s — so every partial already
re-decodes the whole turn. Shrinking the window would truncate what the user sees; cadence is
the honest knob.

## Related Code Files

- Modify: `services/local-stt/engines/base.py` — replace `_lock`/`_recognizer` (~line 63) with a `queue.Queue` of N recognizers; borrow/return in `try/finally`; raise a busy error on acquire timeout; add `LOCAL_STT_POOL` beside `stt_threads()`
- Modify: `services/local-stt/engines/zipformer_vi.py`, `services/local-stt/engines/moonshine_en.py` — `load()` returns one recognizer instead of assigning it (one-line each)
- Modify: `services/local-stt/engines/registry.py` — readiness now means every pool is full
- Modify: `services/local-stt/app.py` — map the busy error to 503; report pool state in `/healthz`; log slow borrows. **Also correct the two docstrings (lines ~5-6 and ~80-81) that currently document the serialization as intent**
- Modify: `services/local-stt/test_app.py` — concurrency test and the 503-on-saturation test
- Modify: `apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts` — record the last decode's duration in `markSettled()`; gate on `max(cadenceMs, factor × lastDecodeMs)`. **Correct the class docstring**, which claims the rate already "falls to whatever the machine can actually sustain"
- Modify: `apps/api/src/modules/translate/audio/partial-transcript-scheduler.spec.ts`
- Modify: `docker-compose.prod.yml`, `docker-compose.yml`, `prod.env.example` — plumb `LOCAL_STT_POOL`
- Modify: `docs/system-architecture.md` — the sidecar concurrency model changed

## Implementation Steps

1. **First, settle thread-safety cheaply.** Run a local experiment driving two concurrent
   decodes through one recognizer and compare transcripts against the serial baseline. If they
   match byte-for-byte across repeated runs, a `Semaphore(N)` replaces the pool at zero memory
   cost; if they differ at all, proceed with the pool. Record the result either way.
2. Implement the chosen mechanism in `base.py`, keeping behaviour identical at pool size 1 so
   the change is a no-op until configured.
3. Update both engines' `load()` to return one recognizer, and registry readiness accordingly.
4. Add the 503 mapping, the `/healthz` pool report, and the slow-borrow log line. Fix the two
   misleading docstrings in the same commit as the behaviour they describe.
5. Make the partial cadence cost-adaptive, and correct its class docstring. Pick the factor so
   the preview costs at most ~1/3 of a lane per turn; state the resulting English refresh
   interval in the comment, since it is user-visible.
6. Plumb `LOCAL_STT_POOL` through both compose files with a prod default of 2. Keep
   `PROD_LOCAL_STT_THREADS` at 4 for pool 1, and lower threads per lane as lanes rise so the
   product stays near 16.
7. Measure RSS on prod at pool 2 under a 12-deep burst before considering pool 3.
8. Run `uv run pytest` in `services/local-stt`, then `pnpm --filter api test`, then lint,
   typecheck, build.

## Success Criteria

- [x] (local equivalent) 6 concurrent same-engine decodes beat serial — pinned by `test_concurrent_decodes_overlap` (< 0.75×, steady-state measured ~0.50×). The ≤ 0.60× prod probe re-runs at deploy time
- [x] (local equivalent) The slowest of 6 concurrent requests ≤ 3× solo — subsumed by the overlap test; prod staircase re-measured at deploy
- [ ] Peak `local-stt` CPU under a 12-deep burst exceeds 550% of one core (today 447%) — **prod, at deploy**
- [x] RSS is structurally bounded: the semaphore adds ZERO memory (no recognizer copies), so the 2.6GiB ceiling is unreachable by this change by construction; container OOM-watch still applies at deploy
- [x] A saturated engine answers 503 within the bounded wait instead of blocking (`test_saturated_engine_refuses_with_503`, `test_lane_wait_times_out_instead_of_queueing`)
- [ ] With 3 concurrent partial streams, English holds its cadence target and loses no live updates — **prod, at deploy**; the duty gate's contribution is unit-tested (`stretches the cadence by the cost of the last decode`)
- [x] Transcripts unchanged: the 120-decode thread-safety experiment produced byte-identical output on both engines; the test suite's transcript assertions pass
- [x] `uv run pytest` (27) and `pnpm --filter api test` (879) green

## Risk Assessment

**Memory OOM is the failure that is worse than the bug.** ONNX Runtime does not share
initializers across sessions, so each instance carries its own weights (223MB vi / 418MB en
per docstrings, single-instance and dev-measured). The Docker VM total is 7.553GiB with
`local-tts` already holding ~2GiB against its own 4g limit, so the two limits already
oversubscribe the budget. A pool-3 STT concurrent with a TTS burst could OOM-kill the sidecar
mid-conversation — a total STT outage, strictly worse than slow transcripts, and behind a 600s
`start_period` before `/healthz` is honest again. Mitigation: pool size is one env var; ship at
2, measure RSS, then decide. Signal it broke: `docker events` showing an OOM kill, or RSS
climbing past ~2.6GiB. Pre-decided response: drop to pool 1 (today's behaviour) and revisit the
TTS ceiling first.

**Per-instance RSS under _concurrent_ decode is unmeasured.** The docstring figures are
single-decode peaks. Step 7 measures before raising the pool; this is the one number that can
force the design to stay at pool 2.

**ONNX intra-op scaling may be sublinear**, in which case lanes × fewer threads yields less
than hoped and the 0.60× target is missed. The measured threads sweep (1/2/3/4/8) suggests an
interior optimum near total software threads ≈ cores, which is why lanes rise only as threads
fall. Pre-decided response: keep the cadence half, which stands on its own, and report the
achieved ratio honestly rather than restating the target.

**503 reaching a final decode** would fail a turn outright instead of delivering it late. The
pool should make this unreachable for finals if partial demand stays below the pool size, but
if it does happen the turn is lost. Whether a failed turn beats a 3-second-late one is a
product call, flagged rather than assumed.

**Cadence stretching is user-visible** — long English turns would refresh roughly every
0.8–1.1s instead of 0.3s. That is the intended trade (screen updates less often so audio
arrives on time), but it is a UX change and is listed as a plan open question.
