---
phase: 1
title: 'Measure the auto-attribution mechanism'
status: pending
priority: P1
effort: '4-5d (incl. environment restoration)'
dependencies: []
---

# Phase 1: Measure the auto-attribution mechanism

## Overview

Eight measurements, ordered so the cheapest one that can invalidate the others
runs first. No product code. The phase exists to answer whether zero-manual
auto-attribution is deliverable at N=2 — and to answer it on the friendlier
corpus channel, so a failure here stops the delivery before anyone is recorded.

The subject of measurement **inverted** with the premise reversal. The earlier
version of this phase measured assign-or-abstain with no minting and no folding,
because minting was forbidden. Minting and folding are now the requested product,
so they are what gets measured — with the Hungarian remap still held at arm's
length (see plan-level "The Hungarian remap").

## Requirements

**Functional — the eight measurements**

- **M1 — real speech duration.** p10/p50/p90 of **speech** per turn, computed as
  `capturedMs − heldMs − PRE_ROLL_MS`, over ≥3 dogfood sessions totalling ≥50
  turns. **Corrected after red team** — see "M1 must not read `audioMs`".
  `capturedMs` and `heldMs` ship unconditionally on `client.turn.metrics`
  (`ws-events.ts:246,248`) with `reportMetrics: true` already set
  (`use-streaming-translate.ts:313`), so this needs no flag, no sidecar and no
  corpus. Durations only; no voice retained.
- **M2 — N=2 cold, the dominant case.** `MEETING_SIZES` extended to include 2.
  campplus, far-field and clean, cold, 3 held-out splits, at the duration M1
  selects. Reported with signed count error, exact-count rate, sample counts and
  confidence intervals. **M2 is context, not the gate** — see M9.
- **M9 — the bounded-K arm. This is the go/no-go.** `OnlineAttributor` gains a
  `k_max` parameter; run `K_max ∈ {2, 3, None}` at N=2 and N=3, cold, both
  conditions. Report **separately**: misattribution rate (turns from an
  unmodelled speaker assigned to an existing ordinal), abstention rate, and
  exact-count rate among modelled speakers. Also measure P4's above-cap options B
  (suppress assignment once the cap binds) and C (raise `tau_assign` above the
  cap) against option A (assign anyway), so the policy is chosen from numbers.
- **M10 — offline settle-pass arm.** A batch re-cluster over the same cached
  vectors, scored with the same scorer as the online arm, **merge error and split
  error reported separately**. P4's settle pass does not ship unless this clears.
- **M3 — `centroid_cap` sweep.** {None, 3, 5, 10} at cold N=2 and N=3,
  regenerating the per-turn-ordinal curve per cap.
- **M4 — prefix-locked scorer.** A second accuracy column computed with no
  ground truth: cluster → ordinal fixed at creation order, never revised. The gap
  to the Hungarian number is the size of the oracle and is reported as a number.
- **M5 — deferred mint.** A turn below `tau_new` opens a **provisional** cluster
  that renders nothing and carries no ordinal; it becomes real only after a
  second turn independently corroborates it. Measured at k ∈ {1, 2, 3}.
- **M6 — one-of-N seeding.** `run_session.py:147-149` seeds **all** members in
  the warm arm. Add a cell that seeds exactly **one** — the measured analogue of
  bootstrapping from the device owner with zero taps. Report cold / half-warm /
  warm at N=2 and N=3.
- **M7 — alternating turn order.** `run_session.py:156` does `rng.shuffle(schedule)`,
  a uniformly random speaker sequence. Real two-person dialogue alternates.
  Report cold N=2 and N=3 under an alternating schedule beside the shuffled one.
  Validity check on every other number in this phase.
- **M8 — extended session length.** ≥40 turns at N=2 and N=3. `MEETING_TURNS = 5`
  means the published curves stop at 15 (N=3) and 25 (N=5) ordinals; real
  sessions are longer and beyond that horizon **nothing is measured**.

**Non-functional**

- `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` immediately before each official
  run, **exit code recorded in the report** (plan Constraint 11 — the variable
  does nothing when prefixed to a run script).
- Every cell reports per-turn CSV, never only an aggregate.
- Held-out speaker splits; results quoted as a split mean **with range**, never a
  single split. Plan Constraint 13 bounds what any of this can prove.

## Architecture

### M1 must not read `audioMs` (`red-team round 2`)

An earlier draft specified M1 as "p10/p50/p90 of speech duration, from
`audioMs`". **That is the wrong field, and it reproduces the exact bias M1
exists to remove.**

`audioMs` is `Math.round(audio.secondsAt(audio.byteLength) * 1000)`
(`translation-session.service.ts:356`) — the whole buffer sent to `/embed`. That
buffer contains `PRE_ROLL_MS = 320` of pre-speech room tone
(`capture-pump.ts:22`, emitted into every turn) plus every intra-turn pause
shorter than the 500ms hangover, which `capture-pump.ts:428-438` holds and then
flushes back in when speech resumes. The bench, by contrast, selects corpus
clips by `utterance.duration_s >= TURN_S` — i.e. _speech_ — and truncates them
(`build_embedding_cache.py:79,143`).

Setting `TURN_S := p50(audioMs)` therefore hands the bench more voiced seconds
than production gives the embedder, on the steepest part of the curve (campplus
far-field 23.1% @2s → 27.7% @1s). That is the same class of error as quoting
end-to-end latency for turn length, made a second time with more ceremony.

Two further corrections: `audioMs` is emitted **only** when
`SPEAKER_EMBEDDING_ENABLED` is true (`translation-session.service.ts:294-295`;
default false at `env.schema.ts:165`) — so reading it requires enabling the very
flag P6 exists to earn, which contradicts "no new instrumentation". And the claim
_"real per-turn speech duration is unmeasured anywhere in this repo"_ is **false**:
`capturedMs`, `heldMs`, `speechStartedAt` and `speechEndedAt` ship on
`client.turn.metrics` for every turn (`ws-events.ts:242-248`), unconditionally,
with `reportMetrics: true` already set (`use-streaming-translate.ts:313`) and the
comment there stating the turn-length distribution is computed from them.

**M1 computes `capturedMs − heldMs − PRE_ROLL_MS` off the existing turn-metrics
sink.** No flag, no sidecar, and it is the only formulation that isolates speech
from silence.

### M1 runs before environment restoration, and it can invalidate everything

The figure previously treated as turn length — p50 1163ms / p95 2983ms — is
**end-to-end latency**, `docs/development-journey.md:963`, labelled "Tổng, 32
lượt", and superseded at `:996` by p50 859ms / p95 1849ms after the ladder split.

This matters because `scripts/build_embedding_cache.py:56` sets `TURN_S = 2.0`
and applies it at `:143`. **Every session, coldstart, guest and centroid-growth
number in `results/` is measured on exactly 2.0-second clips.** campplus
far-field EER is **27.7% at 1s** against **23.1% at 2s**
(`results/pairwise-summary.csv`) — 4.6 points.

So if p50 lands well under 2.0s, the cache is rebuilt at the measured duration
and every published cold number becomes conditional and must be **requoted, not
reused**. M1 costs one dogfood session and no corpus. Running the bench before it
risks measuring the wrong cell a second time.

### Environment restoration is real work

`benchmarks/speaker-id/` has no `corpora/`, no `models/`, no `fixtures/`, and no
embedding cache on this host. `results/enrollment-probe.log` ends writing to a
path under a different machine's home directory — every published number was
produced elsewhere. `run_session.py:88-93` hard-fails without the cache.

Restoration: gated corpus fetch (GB-scale; `fetch_corpora.py` **will not accept
the licence for you** — that is a human act, and D7 settles that non-commercial
evaluation is in bounds), model download (~129MB), cache build. Then
`probe_enrollment_identification.py` re-embeds anyway — it is **not** a cache
consumer, it embeds inside its scan loop at `:232` and `:246`.

### The RNG hazard is in ONE file, not both (`red-team round 2`)

An earlier draft applied this hazard to `run_session.py` — the file M2 actually
edits — and made byte-identical reproduction a blocking precondition there. **That
is wrong in both directions.**

**`run_session.py` is safe to widen.** Its RNG is constructed _inside_ the size
loop, per split (`:290-292`, `seed = args.seed + 1000 * split`, then
`random.Random(seed)`), the evaluation RNG is `random.Random(seed + 1)` (`:318`),
and eligibility is a per-size check against pool sizes (`:293`), **not**
`min(MEETING_SIZES)`. Adding `2` to `:68` shifts nothing in the N=3 or N=5 cells.
Worse, "fixing" seeding here to `random.Random(seed + size)` would _create_ the
reproduction failure the gate exists to prevent.

**`probe_enrollment_identification.py` is where the hazard lives.** `score_cell`
iterates `for size in sizes` sharing **one** `random.Random(args.seed)`
(`:141-152`, seeded at `:269`), and `:266` uses `min(MEETING_SIZES)` as an
eligibility floor. Adding `2` there drops the floor 3→2 and consumes draws before
size 3 runs, so every N=3 meeting composition changes.

Fix and gate **only that file**: seed per `(size, condition, bucket)`, and assert
the `(3, 5)` run reproduces byte-identically. Otherwise its N=3 re-read is a new
measurement and the published 0.8441 top-1 must be dropped as a pinned baseline
rather than requoted.

**Run that assertion against the existing cache, before any rebuild.** `TURN_S`
is the clip _eligibility_ filter, not only a truncation length
(`build_embedding_cache.py:79`), so rebuilding at the M1 duration changes which
clips each speaker contributes and which speakers clear `MIN_CLIPS`. Asserting
after a rebuild guarantees a failure for a reason unrelated to seeding, and
destroys the check's diagnostic value. Two independent changes, two independent
verifications.

### M8's turn count is capped by the cache, and `MIN_CLIPS` re-draws the pool

M8 asks for ≥40 turns. It cannot be had by editing `MEETING_TURNS` alone:

- `MIN_CLIPS = ENROLL_TURNS + MEETING_TURNS` (`run_session.py:66`) and
  `speaker_rows` drops every speaker below it (`:103`). So `MEETING_TURNS` is not
  a session-length knob — it is **the speaker-eligibility filter**.
- The cache stores at most `MAX_CLIPS_PER_SPEAKER = 12`
  (`build_embedding_cache.py:60`, enforced `:91`). ≥40 turns at N=2 needs
  `MEETING_TURNS = 20` → `MIN_CLIPS = 23` > 12. **The eligible pool is empty** and
  the run dies at the CSV write after burning the full grid sweep.
- The largest feasible value is `MEETING_TURNS = 9` — 18 turns at N=2, 27 at N=3,
  both short of 40 — and even that shrinks the pool from "30 speakers with ≥8
  clips" (`results/session.log:1`) to only those hitting the per-speaker cap: a
  different, smaller, more prolific speaker set, therefore **not comparable** to
  M2.

**RESOLVED — validation V5: decouple `MIN_CLIPS` from `MEETING_TURNS`.** Pin
`MIN_CLIPS = 8` and sample turns **with replacement** from a fixed pool, so
session length stops being an eligibility filter and the 30-speaker pool holds
still across M2, M8 and M9. That comparability is the point — an M8 measured on a
different, more prolific speaker set answers a different question.

The cost is honest and must travel with the number: clips repeat within a long
session, so a speaker's later turns are not acoustically independent and the
**drift curve may read optimistic**. State that beside every M8 result, along with
the realised turn count and pool size.
<!-- Updated: Validation Session 1 - V5 -->

### `centroid_cap` freezes; it does not track

The docstring says _"Bounded, the centroid keeps tracking"_ (`online.py:83-88`).
The implementation does not: `fold` returns early once `self.turns >= cap`
(`:67-70`), **discarding** the vector. It is freeze-after-k, not a sliding window.
`turns` starts at 1 (`:59`), so `cap=3` folds exactly two more vectors and then
never updates again.

If the within-session decay is drift — which the docstring itself gives as the
motivation — freezing the centroid on a speaker's first few turns makes it
**worse**. M3 must therefore sweep two distinct arms and label them honestly:
`centroid_freeze` (current behaviour) and a genuine sliding window (keep the last
`cap` vectors, recompute). Reporting "no cap arrests it" from the freeze arm alone
would blame the algorithm for an implementation defect.

### The count bar binds in three places, and the script's verdict points at the wrong cell

`COUNT_ERROR_MAX` is not only an acceptance test. It appears at `:210`
(`acceptable()`), **`:244` inside `calibrate()`** — where it constrains which
`(tau_assign, tau_new)` pair the grid may select — and `:275`/`:352` in printing.
D6 replaces the acceptance use; leaving `:244` alone means calibration keeps
selecting thresholds under the rule D6 calls degenerate, including operating
points that merge two people.

**RESOLVED — validation V4: NO-CONFIG at N=2 reads UNDETERMINED, not FAIL.**
NO-CONFIG means the grid found no point satisfying both calibration constraints
simultaneously — a statement about the search, not about the mechanism. On
NO-CONFIG, re-run with a loosened count constraint and **report both results**;
D6 then judges at evaluation time, which is where the product bar belongs. A run
that is UNDETERMINED at every operating point is still a stop, but it stops with
a reason rather than a verdict it did not earn.
<!-- Updated: Validation Session 1 - V4 -->

Separately, the script's verdict block still filters
`condition == "far-field" and int(r["meeting_size"]) == 5` (`:392-395`) and
`main()` returns `0 if warm_pass else 1` (`:414-421`) — the **warm N=5** arm. D3
makes N=2 the gate and D4 deletes enrollment from the product. Under Constraint 11
the recorded exit code would certify a cell this plan abandoned. Repoint both, or
strike the exit-code provenance requirement for this script.

### The count bar is replaced, not relaxed

`COUNT_ERROR_MAX = 1.0` is degenerate at N=2: collapsing two people into one
cluster scores `|dN| = 1` and passes. And `run_session.py:200` applies `abs()`,
discarding the sign — so the repo **cannot currently distinguish over-split from
merge**, whose repairs are opposite.

Replace with two numbers derived from `SessionScore.speaker_count_error`
(`online.py:163-164`):

- **signed** mean count error;
- **exact-count rate** = fraction of meetings where `clusters == true_speakers`.

**Bar (D6):** campplus, far-field, N=2, cold — **accuracy ≥ 0.85 and exact-count
rate ≥ 0.90 on ≥2 of 3 splits.** Accuracy 0.85 rather than the inherited 0.70
because chance at N=2 is 0.50, and a swapped chip in a _translation_ app is a
semantic error, not a cosmetic one.

### Why M5 (deferred mint) is the lever aimed at the failing metric

Over-count is spurious **singleton** clusters — a turn that fell below `tau_new`
but belonged to an existing speaker. Requiring k≥2 corroboration converts most of
those into abstentions, trading attribution rate for count error.

**The headroom is in the right direction, and it is large.** Cold N=3 far-field
runs attribution 0.923–0.944 against a floor of 0.80 — **12-14 points of slack** —
while count error is only 0.16–0.26 above its bar. That is a hypothesis, not a
measurement: no arm in this repo implements corroboration.

### The mint dial is already priced — retained as a cost, not a prohibition

`results/guest.log`, campplus far-field, 4 enrolled + 1 guest, `tau_assign` 0.350:

| `tau_new` | guest own-cluster | guest stolen | enrolled acc | spurious-new |
| --------- | ----------------- | ------------ | ------------ | ------------ |
| 0.150     | 0.6%              | 67.3%        | 86.1%        | 0.0%         |
| 0.250     | 13.8%             | 63.9%        | 84.0%        | 3.0%         |
| 0.300     | 33.9%             | 56.7%        | 80.1%        | 8.1%         |
| 0.350     | **49.2%**         | 50.8%        | **74.7%**    | **14.7%**    |

There is no setting where "new person → new chip" and "same person → same chip"
are both mostly right. The earlier plan read this table as a prohibition; the
user overturned that. It is now the **cost curve** P4 operates on, and the reason
`K_max` bounds the damage instead of a threshold trying to.

### Centroid growth does not saturate

`results/centroid-growth.csv`, campplus far-field:

| turns         | 1      | 2      | 3      | 4          | 5          |
| ------------- | ------ | ------ | ------ | ---------- | ---------- |
| EER           | 0.1723 | 0.1541 | 0.1467 | **0.1327** | **0.1503** |
| target_scores | 325    | 292    | 259    | 226        | 193        |

It reverses at 5, on a shrinking sample. At 226 target scores an EER near 13%
carries roughly ±2.3 points of standard error — the whole 17.2→13.3 movement is
under two standard errors. **Do not record "saturation at 4."** Report the curve
with intervals.

## Related Code Files

- Modify: `benchmarks/speaker-id/run_session.py` — `MEETING_SIZES` (`:68`) to
  include 2; `centroid_cap` passed at `:144`; the deferred-mint arm; one-of-N
  seeding at `:147-149`; alternating schedule beside `rng.shuffle` at `:156`;
  `MEETING_TURNS` for M8; signed count error at `:200`
- Modify: `benchmarks/speaker-id/speaker_bench/online.py` — corroboration
  (provisional clusters) for M5; a prefix-locked scorer beside `score_session`
  for M4
- Modify: `benchmarks/speaker-id/scripts/probe_enrollment_identification.py` —
  per-size RNG seeding (`:269`), `MEETING_SIZES` (`:85`), the `min()` eligibility
  floor (`:266`)
- Modify: `benchmarks/speaker-id/scripts/build_embedding_cache.py:56` — `TURN_S`,
  only if M1 says 2.0 is wrong
- Modify: `benchmarks/speaker-id/scripts/probe_centroid_growth.py` — sample counts
  and intervals
- Create: `results/turn-duration-histogram.csv` (M1)
- Create: `results/session-summary-n2.csv`, `results/session-coldstart-n2.csv`
- Create: `results/centroid-cap-sweep.csv` (M3)
- Create: `results/deferred-mint-sweep.csv` (M5)
- Read-only: `packages/realtime-client/src/state/turn-keyed-transcript.ts:402-405`
  (where `audioMs` already lands, M1's source)

## Measurement Status — 2026-08-31 (SUPERSEDED, see below)

> **M1 was measured later the same day and invalidated everything in this
> section.** Real turn length is p50 **1065ms**, not the assumed 2.0s; the cache
> was rebuilt at 1.0s and every arm re-run. **Every arm now fails, on both
> columns.** The `k_max=2, assign` result below — the one that passed — scores
> prefix-locked **0.589** at the real duration and 0/3 PASS.
>
> Authoritative: `reports/measurement-260831-2200-m1-and-remeasure-at-real-turn-length.md`.
> The numbers below are retained because they document the 2.0s cell and the
> reasoning that led to measuring M1, not because they describe the product.

## Superseded 2.0s results — 2026-08-31

**M2–M10 are measured.** Full numbers, caveats and open questions:
`reports/measurement-260831-1400-phase-01-results.md`. Run on
`ssh.quanganh208.dev` against the real VoxVietnam cache; 242 tests pass there.

Headline, campplus far-field N=2 **cold** (the gate cell), mean of 3 held-out
splits:

| arm              | exact-count | over-split | merge | verdict (oracle) | verdict (shippable) |
| ---------------- | ----------- | ---------- | ----- | ---------------- | ------------------- |
| unbounded        | 0.378       | 0.587      | 0.035 | FAIL             | FAIL                |
| k_max=2, assign  | 0.973       | 0.000      | 0.027 | PASS             | **FAIL**            |
| k_max=2, abstain | 0.825       | 0.000      | 0.175 | FAIL             | FAIL                |
| k_max=3, assign  | 0.352       | 0.622      | 0.027 | FAIL             | FAIL                |

**The one arm that passes, passes only on the oracle column.** Across the six
unenrolled gate cells, `accuracy` passes 5/6 and prefix-locked passes **1/6**.
`accuracy` is scored by `linear_sum_assignment` against ground truth the product
never has. And `exact-count 0.973` is largely forced: capping K at 2 in a
two-person meeting makes the count correct by construction, so it is not
independent evidence. On the shippable column accuracy is 0.76-0.85 — about one
attributed turn in five goes to the wrong person.

**Checkpoint 1 independently returned KILL.** `run_pairwise.py` on the same
corpus reports 22.5-26.0% EER at the gate cell against a 15% kill line, and
prints _"Do not start Phase 4"_ — the phase that writes product code.

Decisions the numbers settle:

- **Above-cap policy: option A (`assign`).** B and C reach their counts by
  merging (0.175, 0.188 vs A's 0.027) — the direction D4 forbids netting away.
- **M10: the settle pass does not ship.** 0/36 held-out cells merge-free.
  Strictly worse than the online arm.
- **M3 and M5 are not levers.** Centroid freeze/window are inert; deferred mint
  is NO-CONFIG at k=2 and k=3.

**D5 needs revising.** `k_max` does not fix over-splitting in general — it fixes
it only when the cap equals the true N. `k_max=2` scores 0.973 at N=2 and
**0.000 at N=3**; `k_max=3` scores 0.352 at N=2. `K_max` is therefore a bet on
the speaker count, and the product's premise is that the count is unknown. That
is an open product decision, not a measured recommendation.

**No product code is authorised by this phase.** The shippable column fails,
Checkpoint 1 says KILL, and the channel gate (P2) has never run. An open
decision remains for the user: whether the acceptance bar should judge the
prefix-locked column rather than `accuracy`. The harness now reports both and
warns on divergence; it does not decide.

**M1 is still unmeasured, and everything above is conditional on it.** The cache
was built at the assumed `TURN_S = 2.0s`. `TURN_METRICS_PATH` is UNSET on the
running `chatofy_prod_api` container; enabling it is the cheap unblock.

## Implementation Status — 2026-08-30

**The harness is built. Nothing has been measured.** Those are separate halves of
this phase and only the first was reachable on this host.

### Landed and verified

`speaker_bench/online.py` — `k_max`, the three above-cap policies (`assign`,
`abstain`, `raise_tau` + `tau_assign_capped`), `centroid_window` as a tracking
arm distinct from `centroid_cap`'s freeze, and `mint_confirmations` for deferred
mint. **Every new parameter defaults to the previous behaviour**, asserted by a
regression test, so the published cold numbers still describe the code that
produced them.

`speaker_bench/scoring.py` (new) — `score_prefix_locked` (M4) and `count_metrics`
(signed error, exact-count rate, over-split and merge rates reported apart).

`speaker_bench/settle.py` (new) — the offline settle pass (M10) with merge and
split error counted separately and never netted.

`run_session.py` — N=2 added to `MEETING_SIZES`; `MIN_CLIPS` decoupled from
`MEETING_TURNS` (V5) with with-replacement sampling above a speaker's clip count;
D6's bars wired size-dependently; `COUNT_ERROR_MAX` reconciled at its three
sites; NO-CONFIG re-run under a loosened count constraint and reported as
UNDETERMINED (V4); gate cell and exit code repointed from warm N=5 to **cold
N=2 far-field**; CLI flags for every arm (`--k-max`, `--above-cap`, `--turns`,
`--centroid-cap`, `--centroid-window`, `--mint-confirmations`).

Verification: **190 tests pass** (58 of them new, covering the bounded-K
policies, deferred mint, freeze-vs-track, both scorers and the settle errors),
plus an end-to-end run of `run_session.py` over a synthetic cache exercising
calibrate, the loosened retry, the CSV schema, the gate cell and the exit code.

Two defects were found by that run and fixed: the printed "N/M splits PASS" line
disagreed with the CSV verdict on loosened cells, and an arm that produces no
evaluated cell crashed at the CSV write instead of reporting an empty result —
which the `abstain` above-cap arm reaches legitimately, so M9 would have hit it.

### Blocked, and why

- **M1** needs >=3 dogfood sessions of >=50 real turns through a running stack
  with `TURN_METRICS_PATH` set. A person has to talk into the product.
- **Environment restoration** (step 3): `models/`, `corpora/`, `fixtures/` and
  the embedding cache are all **absent on this host**. Restoration needs a human
  to accept the corpus licence, then a multi-GB fetch.
- **Every measurement (M2-M10)** depends on that cache. The harness runs; it has
  nothing to run on.
- **Step 2, the RNG fix**, is deliberately NOT done. Its whole safety property is
  a byte-identical assertion against the **existing** cache, and there is no
  existing cache to assert against. Writing the change blind would produce
  exactly the unverifiable edit the step exists to prevent.

## Implementation Steps

1. **M1 first, before restoration.** Compute `capturedMs − heldMs − PRE_ROLL_MS`
   from the existing turn-metrics sink over ≥3 dogfood sessions, ≥50 turns.
   Record p10/p50/p90. Decide `TURN_S`.
2. **RNG fix and its byte-identical assertion, against the EXISTING cache**, in
   `probe_enrollment_identification.py` only. It needs no new data, and running it
   after a rebuild would guarantee a failure unrelated to seeding.
3. **Environment restoration**, with its own effort line: accept the corpus
   licence (a human act; D7 settles that non-commercial evaluation is in bounds),
   fetch corpora, download models, build the cache at the M1 duration, run pytest.
   Decide `MAX_CLIPS_PER_SPEAKER` here — M8 depends on it.
4. Add the prefix-locked scorer (M4) and the signed/exact-count metrics. Report
   the oracle gap on every existing cell — this costs no new data.
5. Add `k_max` to `OnlineAttributor`; reconcile `COUNT_ERROR_MAX` at all three
   sites and repoint the script's gate cell and exit code at far-field N=2 cold.
6. Run M2 (unbounded, N=2) as **context**, then **M9 (bounded-K) as the
   go/no-go**, including above-cap options A/B/C.
7. Run M3 (both `centroid_freeze` and sliding-window arms), M6, M7 in parallel.
8. Implement and run M5 (deferred mint) at k ∈ {1,2,3}.
9. Run M8 at the achievable turn count, reporting realised turns and pool size.
10. Run M10 (offline settle-pass arm), merge and split error separate.
11. Report every cell with PASS / FAIL / UNDETERMINED-UNTIL-P2 (within 3 points),
    split mean with range, sample count, and the pytest exit code beside it.
12. Recommend `K_max` **and** the above-cap policy from M9, naming the cells.

## Success Criteria

- [ ] M1: **speech** duration recorded as `capturedMs − heldMs − PRE_ROLL_MS`
      from the existing turn-metrics sink — not `audioMs`, and with no flag
      enabled; `TURN_S` selected from it; if it differs from 2.0 the cache is
      rebuilt and every reused number requoted
- [ ] RNG fixed **in `probe_enrollment_identification.py` only**, asserted
      against the **existing** cache before any rebuild; `run_session.py:68`
      documented as safe to widen, citing `:292` and `:318`
- [ ] Environment restored: corpus, models, cache present and version-matched;
      `MAX_CLIPS_PER_SPEAKER` decided
- [ ] **M9 (bounded-K) is the go/no-go** — `K_max ∈ {2, 3, None}` at N=2 and N=3,
      with **misattribution rate, abstention rate and exact-count rate reported
      separately**, and above-cap options A/B/C priced
- [ ] D6's bars (accuracy ≥ 0.85, exact-count ≥ 0.90 on ≥2 of 3 splits) applied
      to the **bounded** configuration; M2's unbounded numbers reported as context
- [ ] M10: offline settle-pass arm measured, **merge error separate from split
      error**. P4's settle pass does not ship without it
- [ ] `COUNT_ERROR_MAX` reconciled at all three sites (`:210`, `:244`, `:275`);
      whether NO-CONFIG at N=2 reads FAIL or UNDETERMINED is pre-decided
- [ ] The script's gate cell (`:392-395`) and exit code (`:414-421`) repointed at
      far-field N=2 cold, or the exit-code provenance requirement struck for it
- [ ] M3 sweeps **both** `centroid_freeze` and a sliding window, labelled honestly
- [ ] M8 run with `MIN_CLIPS` decoupled from `MEETING_TURNS` (V5), pool identical
      to M2/M9's, and the clip-repetition caveat stated beside every number
- [ ] NO-CONFIG at N=2 handled per V4: re-run loosened, both results reported,
      read as UNDETERMINED rather than FAIL
- [ ] M4: prefix-locked accuracy reported beside every Hungarian number; the gap
      stated as a number
- [ ] Signed count error and exact-count rate replace bare `|dN|` everywhere
- [ ] M3: `centroid_cap` swept; turn-0 → turn-14 delta per cap reported.
      **"No cap arrests it" is a valid, reportable finding** — not a retry trigger
- [ ] M5: deferred mint at k ∈ {1,2,3}; the attribution-rate cost and the
      count-error gain both reported
- [ ] M6: one-of-N seeding reported beside cold and full-warm
- [ ] M7: alternating schedule reported beside shuffled
- [ ] M8: ≥40 turns; accuracy at the last ordinal decile reported and stated
      whether it is still falling
- [ ] Centroid growth reported 1-5 with sample counts and intervals; **no
      "saturation" claim** unless the intervals support one
- [ ] `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded per run
- [ ] A recommended `K_max` with the cell that supports it

## Risk Assessment

**N=2 cold fails on the friendlier channel.** This is the outcome the phase
exists to expose. _Signal:_ M2 misses accuracy 0.85 or exact-count 0.90 on ≥2
splits. _Response:_ stop before P2. Do not relax the bar to manufacture a pass —
D6 was set deliberately and reversing it is a user decision, not an author's.

**M1 says real turns are much shorter than 2.0s.** _Signal:_ p50 well under 2.0s.
_Response:_ rebuild the cache and re-read every cell. Every published cold number
becomes conditional. This is why M1 is first: discovering it after the bench runs
wastes the whole restoration.

**A pass here reads as permission to ship.** It is not — corpus audio is
channel-optimistic. _Response:_ P1 may only cut in the negative direction.

**The 3-point undetermined band swallows the decision.** _Response:_ accept it;
the band exists so a too-close number does not masquerade as a verdict.

**Environment restoration overruns and destabilises the session booking.**
_Signal:_ the corpus fetch or cache build slips past its estimate. _Response:_
P2's recording session is scheduled only after P1 reports, never in parallel.

**The evidence base cannot carry the weight put on it.** 30 speakers, 15
evaluated per split, three overlapping shuffles (plan Constraint 13). _Response:_
every number carries its sample count and range; no tuning to the second decimal;
a result inside the noise is reported as inside the noise.
