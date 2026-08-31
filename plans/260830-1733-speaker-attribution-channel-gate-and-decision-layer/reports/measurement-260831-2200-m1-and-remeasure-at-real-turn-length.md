---
type: measurement
phase: 1
date: 2026-08-31
supersedes: measurement-260831-1400-phase-01-results.md
verdict: unenrolled auto-attribution FAILS at the measured turn length — every arm, both columns
---

# M1 measured, and it invalidated Phase 1

## M1 — the product's real turn length

Recorded off the production turn-metrics sink (`TURN_METRICS_PATH` enabled on
`chatofy_prod_api`, 2026-08-31), 21 turns, raw data at
`benchmarks/speaker-id/results/turn-metrics-m1.jsonl`.

|                                          | p10       | p50        | p90        | max    |
| ---------------------------------------- | --------- | ---------- | ---------- | ------ |
| Gate span (open → close)                 | 830ms     | 1429ms     | 3671ms     | 4560ms |
| **Speech (`capturedMs − heldMs − 320`)** | **490ms** | **1065ms** | **3239ms** | 4220ms |

- **5 of 21 turns reach 2.0s of speech.** The cache was built at exactly 2.0s.
- **10 of 21 are under 1.0s.**

`TURN_S` is now **1.0s**, threaded through `build_embedding_cache.py --turn-s`
and **stamped into the cache** (`turn_s` key); `run_session.py` prints it and
labels a pre-M1 cache `UNSTAMPED`. A cached vector whose duration is unknown is
a number without a cell.

### The plan's M1 formula does not do what it claims

The plan specifies `capturedMs − heldMs − PRE_ROLL_MS` to "isolate speech from
silence", on the belief that `heldMs` accounts for intra-turn pauses held and
flushed back. It does not. The contract defines `heldMs` as audio _"held back
and **never sent**"_ (`ws-events.ts:248`) and `turn-pipeline.ts:440` resets
`pendingMs` to 0 on flush — so a completed turn always reports **`heldMs = 0`**,
as all 21 rows do.

The formula therefore reduces to `capturedMs − 320` and still contains every
intra-turn pause shorter than the hangover. **1065ms is an upper bound; true
speech is shorter.** This strengthens the conclusion below rather than weakening
it, which is why the number was used as-is rather than re-derived.

## The re-measurement — everything moved, and downward

Gate cell throughout: campplus, far-field, N=2, **cold** (unenrolled — the
zero-manual product). Mean of 3 held-out splits, 400 meetings each.

| arm                  | exact-count | accuracy | prefix-locked | attributed | PASS (oracle \| shippable) |
| -------------------- | ----------- | -------- | ------------- | ---------- | -------------------------- |
| unbounded            | 0.158       | 0.472    | 0.426         | 0.937      | 0/3 \| 0/3                 |
| **k_max=2, assign**  | **1.000**   | 0.803    | **0.589**     | 0.980      | **0/3 \| 0/3**             |
| k_max=3, assign      | 0.158       | 0.764    | 0.621         | 0.971      | 0/3 \| 0/3                 |
| k_max=2/3, abstain   | —           | —        | —             | —          | NO-CONFIG                  |
| k_max=2/3, raise_tau | —           | —        | —             | —          | NO-CONFIG                  |
| alternating order    | 0.178       | 0.459    | 0.437         | 0.936      | 0/3 \| 0/3                 |
| half-warm (1 of 2)   | 0.158       | 0.472    | 0.426         | 0.937      | 0/3 \| 0/3                 |
| 20 turns/speaker     | 0.308       | 0.773    | 0.698         | 0.949      | 0/3 \| 0/3                 |

**Not one configuration passes. `unenrolled mode: FAIL` on all seven M9 arms.**

### What changed from the 2.0s cache

| campplus, far-field N=2 cold     | at 2.0s (assumed) | at 1.0s (measured) |
| -------------------------------- | ----------------- | ------------------ |
| unbounded accuracy               | 0.824             | **0.472**          |
| k_max=2 assign accuracy          | 0.863             | 0.803              |
| k_max=2 assign **prefix-locked** | 0.789             | **0.589**          |
| k_max=2 assign verdict           | 2/3 PASS          | **0/3**            |

The unbounded arm loses **35 accuracy points**. The oracle gap on the winning
arm widens from ~8 points to **21** — at a one-second turn the Hungarian
assignment is doing most of the work, and the product cannot do it.

**`exact-count 1.000` is the clearest evidence that the count metric is not a
quality metric.** It is _perfect_ — better than at 2.0s — while accuracy falls,
because capping K at 2 in a two-person meeting makes the count right by
construction regardless of whether the turns were assigned to the right people.
At `locked 0.589`, roughly **four attributed turns in ten name the wrong
speaker**, with the count on screen looking flawless.

### M10 settle, at the real duration

`12/36` held-out cells merge-free unbounded, `0/36` capped — better than the
0/36 measured at 2.0s but still far from clearing. The settle pass does not
ship.

## What this means

**The zero-manual premise is not deliverable on current evidence.** The user's
requirement — _"không muốn user phải manual bất cứ chỗ nào, tự động detect,
hiển thị người 1, người 2"_ — needs the cold arm to work. It does not, at any
`K_max`, under any above-cap policy, at the turn length the product actually
produces.

Enrolled mode still passes (`enrolled mode: PASS` on most arms), which is the
flow the premise reversal removed.

Three independent signals now agree, which is why this is not a tuning problem:

1. **Checkpoint 1** (`run_pairwise.py`): 22.5–26.0% EER against a 15% KILL line,
   printing _"Do not start Phase 4"_.
2. **Phase 5**: four models across three corpora span a 3.5-point band — the
   embedder is not the bottleneck.
3. **Phase 1 at the measured duration**: every arm fails, both columns.

## Corrections this run forced

- Every "PASS" in `measurement-260831-1400-phase-01-results.md` was measured at
  an assumed 2.0s and is **superseded**. That report already carried an oracle
  correction; this supersedes it on duration as well.
- **Bug found and FIXED** (2026-08-31, after this run): `outcomeFor()`
  (`conversation-session.ts`) was a fall-through returning `'error'` for any
  reason it did not name. The server's `voice_off` — which `turn-timeline.ts`
  defines as _"a SUCCESSFUL turn that was never meant to be spoken"_ — was
  therefore recorded as `outcome: error` on **all 21** client rows while the
  server reported `completed: true` for 16 of 17.

  Three more server reasons hit the same fall-through: `unsupported_audio`,
  `client_gone` and `idle_timeout`. All four are now named — `voice_off` shares
  `completed`'s rule (so it yields `no_audio` with speech off), the two delivery
  failures map to `dropped`, and `idle_timeout` stays `error` deliberately
  rather than by accident. The unknown-reason default survives, because
  `server.session.ended.reason` is `z.string()` on the wire.

  **The M1 numbers above are unaffected** — the label describes playback, not
  capture. But the JSONL rows already collected still carry the wrong label, and
  the fix reaches production only on the next web build and deploy.

## Unresolved questions

1. **Does the product change, or does the feature stop?** Options the harness
   cannot decide: require enrolment (contradicts the premise), gate attribution
   to turns above some length and abstain below, ship ordinals as explicitly
   best-effort, or drop the feature. This is a product decision.
2. **n=21, not the ≥50 the plan requires**, and one contiguous sitting rather
   than ≥3 sessions. The user accepted this to lock the value. p50 would have to
   be wrong by roughly 2× to restore the 2.0s conclusion, which 21 turns already
   makes implausible — but the sample is formally short.
3. Pool is still thin: 31 speakers with ≥8 gap-separated clips at 1.0s (was 30).
   `MAX_CLIPS_PER_SPEAKER = 12` and the gap rule bind, not the duration.
4. `SPEAKER_BENCH_REQUIRE_PARITY=1` still unenforced (no Node on the remote).
