---
type: measurement
phase: 1
date: 2026-08-31
host: ssh.quanganh208.dev (16 cores, 31GB, no GPU, prod stack co-resident)
corpus: VoxVietnam test split, 26,523 utterances / 150 speakers
cache: results/embedding-cache.npz — 1814 clips x 2 models x 2 conditions
---

# Phase 1 measured — M2 through M10

> **CORRECTION, 2026-08-31 (later).** An earlier version of this report headlined
> `k_max=2, assign` as **PASS** at the gate cell. That verdict is scored on
> `accuracy`, which maps clusters onto speakers with `linear_sum_assignment`
> **after seeing ground truth** — an oracle the product does not have. Under the
> same bar applied to the **prefix-locked** column, which is what a shipping
> product reaches, the unenrolled cells pass **1 of 6**, not 5 of 6:
>
> | model      | split     | Hungarian (≥0.85)                | prefix-locked (≥0.85)              |
> | ---------- | --------- | -------------------------------- | ---------------------------------- |
> | eres2netv2 | 0 / 1 / 2 | 0.874 / 0.913 / 0.858 — all PASS | 0.797 / 0.854 / 0.761 — **1 PASS** |
> | campplus   | 0 / 1 / 2 | 0.845 / 0.881 / 0.863 — 2 PASS   | 0.767 / 0.819 / 0.783 — **0 PASS** |
>
> And the headline **exact-count 0.973 is largely forced arithmetic**, not
> evidence of quality: capping K at 2 in a two-person meeting makes the count
> right by construction. The quality signal is accuracy, and on the honest
> column that is 0.76–0.85 — roughly **one attributed turn in five goes to the
> wrong person**.
>
> `run_session.py` now prints a per-cell prefix-locked count and an explicit
> ORACLE warning whenever the two columns disagree, and records
> `prefix_locked_verdict` per row. The exit code and the bar are **unchanged** —
> which column gates is a plan decision, not the harness's.
>
> **Read every "PASS" below with this correction applied.**

**M1 was NOT measured and everything here is conditional on that.** See "What is
still blocked".

Environment restored on the remote host: `uv sync` (~40s, vs a 45-min hang on
the Mac), onnxruntime symlink, models present, corpora present, cache built.
Test suite there: **242 passed, 71 skipped, 0 failed** — including the 12 tests
that could only `ModuleNotFoundError` locally. 71 skips are gate-parity tests
needing the Node workspace; they do not touch the session bench, which never
calls `segment.py`.

## The gate cell — campplus, far-field, N=2, cold (unenrolled)

Mean over 3 held-out splits, 400 evaluation meetings each.

| arm                         | exact-count | accuracy    | prefix-locked | attributed | merge       | over-split  | verdict   |
| --------------------------- | ----------- | ----------- | ------------- | ---------- | ----------- | ----------- | --------- |
| unbounded (baseline)        | 0.378       | 0.824       | 0.765         | 0.947      | 0.035       | 0.587       | FAIL      |
| **k_max=2, assign**         | **0.973**   | **0.863**   | **0.789**     | **0.926**  | **0.027**   | **0.000**   | **PASS**  |
| k_max=2, abstain            | 0.825       | 0.813       | 0.760         | 0.883      | 0.175       | 0.000       | FAIL      |
| k_max=2, raise_tau          | —           | —           | —             | —          | —           | —           | NO-CONFIG |
| k_max=3, assign             | 0.352       | 0.837       | 0.773         | 0.928      | 0.027       | 0.622       | FAIL      |
| k_max=3, abstain            | 0.439       | 0.835       | 0.784         | 0.919      | 0.096       | 0.465       | FAIL      |
| k_max=3, raise_tau          | 0.567       | 0.808       | 0.761         | 0.919      | 0.188       | 0.245       | FAIL      |
| centroid freeze 3/5/10      | 0.359–0.378 | 0.824–0.825 | —             | —          | 0.027–0.035 | 0.587–0.613 | FAIL      |
| centroid window 3/5/10      | 0.377–0.381 | 0.824–0.826 | —             | —          | 0.023–0.035 | 0.587–0.597 | FAIL      |
| deferred mint k=2, k=3      | —           | —           | —             | —          | —           | —           | NO-CONFIG |
| half-warm (1 of 2 enrolled) | 0.378       | 0.824       | 0.765         | 0.947      | 0.035       | 0.587       | FAIL      |
| alternating order           | 0.283       | 0.805       | 0.769         | 0.929      | 0.032       | 0.686       | FAIL      |

eres2netv2 at `k_max=2, assign`: **3/3 splits PASS**, exact 0.975 / 0.943 /
1.000, over-split 0.000 on every split. campplus: 2/3 (split 0 FAIL).

## Findings

**1. The unbounded attributor fails the product's actual case.** Unenrolled
far-field N=2: exact-count 0.378 against a 0.90 bar. Over half of two-person
conversations render the wrong number of people. Enrolled mode passes 3/3
(exact 0.991) — so the published warm numbers were never the user's case.

**2. `k_max=2` + `assign` is the only arm that clears, and it clears cleanly.**
Over-split 0.587 → **0.000** while merge stays at baseline (0.027 vs 0.035). It
does not buy the count by merging. That distinction is the whole reason D4 says
never to net the two.

**3. Options B and C fail, and fail in the invisible direction.** `abstain`
reaches exact 0.825 and `raise_tau` 0.567 — but their merge rates are 0.175 and
0.188, five to seven times option A's. They buy count accuracy by folding two
people into one ordinal. Recommend **option A (assign)**.

**4. `k_max` only helps when it equals the true N — the plan did not anticipate
this.** D5 reads as though bounding K fixes over-splitting. It does not:

|           | N=2 cold  | N=3 cold    |
| --------- | --------- | ----------- |
| unbounded | 0.378     | 0.342       |
| k_max=2   | **0.973** | **0.000**   |
| k_max=3   | 0.352     | 0.852–0.992 |

`k_max=3` at N=2 (0.352) is no better than unbounded (0.378). `k_max=2` at N=3
is **exact-count 0.000 and accuracy 0.592** — the cap guarantees a merge, and a
merge is the failure the user cannot see. So `K_max` is not a constant that can
be shipped: it is a bet on the speaker count, and the product's premise is that
the count is unknown. **This is the open decision, not a measured
recommendation.**

**5. M10 — the settle pass does not clear, and should not ship.** 0/36 held-out
cells merge-free at the calibrated threshold. Unbounded settle shatters
sessions into **2.7–5.9 extra clusters**; capping it converts that into merges
of 0.34–0.59 per session. Both are far worse than the online arm's 0.027 merge
/ 0.000 over-split. P4's settle pass fails its precondition.

**6. M3 — both centroid arms are inert.** Freeze and sliding window move
exact-count by at most 0.02 in either direction, inside split-to-split spread.
Neither is a lever. `centroid_cap=10` reproduces the baseline exactly.

**7. M5 — deferred mint is not the lever the plan hoped.** NO-CONFIG at k=2 and
k=3: provisional clusters render nothing, so attribution rate never reaches the
94% calibration target. Aimed at the failing metric, it removes the passing one.

**8. M6 — partial enrolment buys nothing.** Seeding 1 of 2 members reproduces
the cold arm exactly (0.378) and flips enrolled mode to FAIL. "Enrol the device
owner only" is not a viable middle path at N=2.

**9. M7 — the shuffled schedule is optimistic.** Real alternating dialogue:
exact 0.283 vs 0.378 shuffled, over-split 0.686 vs 0.587. Conclusions do not
flip, but every unbounded number in this phase reads ~4-9 points better than
alternating order would give.

**10. M8 — session length does not make it worse.** At 20 turns/speaker
(40-turn sessions, vs the published 5) cold exact-count is 0.392 / 0.391
against 0.378 at 5 turns; warm reaches exact 0.903 / 0.957, 2/3 PASS. So the
"beyond the 5-turn horizon nothing is measured" gap is now measured, and
nothing degrades there. **Caveat the bench states itself:** the thinnest
speaker has 5 meeting clips, so 20 turns are sampled WITH REPLACEMENT — a
repeated clip is an easier turn than a fresh one, and the drift curve reads
optimistic.

**11. M4 — the oracle is small.** Hungarian minus prefix-locked: mean +3.0pt,
max +8.0pt over 72 cells. The prefix-locked column is close to the headline, so
the headline is not mostly oracle.

**Threshold transfer:** mean +3.2pt, p90 +10.2pt, **max +17.3pt** against a
14pt margin. The margin covers p90 but not the worst split.

## What is still blocked

- **M1 — not measured.** `TURN_METRICS_PATH` is a key in `apps/api/.env` but the
  running `chatofy_prod_api` container has it UNSET, and no JSONL exists. M1
  needs ≥3 dogfood sessions of ≥50 real turns. **Enabling that env var on the
  prod container is the cheap unblock.**
- **Consequence:** the cache was built at the default `TURN_S = 2.0s`, an
  assumption and not a measurement. If M1 says the real speech duration differs,
  the cache and **every number above** must be rebuilt. Plan step 1 puts M1
  first for exactly this reason.
- **Pool is thin:** 30 speakers with ≥8 gap-separated clips (76 speakers / 488
  clips under the spread policy). Split in half for calibration, N=2 meetings
  draw from ~15. Wide split-to-split spread follows from this.
- **Parity not enforced.** `SPEAKER_BENCH_REQUIRE_PARITY=1` needs Node/pnpm,
  absent on the remote. Not required for the session bench (no `segment.py`),
  but no run here has verified segmentation provenance.

## Unresolved questions

1. **What `K_max` ships, given the product cannot know N?** `k_max=2` passes the
   gate cell and silently merges any third speaker. Options: gate the feature to
   declared-2-person sessions; detect N and adapt the cap; accept the merge and
   surface it in UI. Needs a product decision, not another sweep.
2. Does M1's real duration match 2.0s? Everything above is conditional on it.
3. Is the 14pt calibration margin enough given max transfer loss 17.3pt?
4. Is a 30-speaker pool sufficient provenance for a ship decision, or does the
   cache need rebuilding with a lower `MIN_CLIPS`?
