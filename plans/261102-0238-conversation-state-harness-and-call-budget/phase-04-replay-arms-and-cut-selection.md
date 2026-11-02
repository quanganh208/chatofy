---
phase: 4
title: 'Replay arms and choose cuts'
status: in-progress
priority: P1
effort: '0.5d'
dependencies: [3]
---

# Phase 04: Replay arms and choose cuts

> **State (2026-11-02):** Tasks 4.0–4.3 done. Arm cut+K6+scale 3 passed all three gates: 5.67 calls/turn (54.3%), 4,081 tokens/turn (58.9%), p50 1,307 ms (104.6%). Answer prompts matched the baseline 100%. Digest headroom is 0.59 calls a turn. The live-translate chrF++ run in Task 4.2 step 1 was replaced, at the user's decision, by the free answer-prompt comparison. Task 4.4: a PR makes these values the schema defaults. After it deploys, the three keys come out of `prod.env`. Report: `plans/reports/benchmark-261102-1421-call-budget-cut-arms.md`.

## Goal

Measure the knobs on prod with the same replay as the baseline, and keep switched on only
the combination that meets AC-C1, AC-C2, AC-L and AC-Q1.

## Context to read first

- `plan.md` thresholds; the baseline report; the Phase 03 PR body (which knobs exist and their proposed values).
- `benchmarks/live-translate/README.md` (cascade arm, `score-adequacy.py`).
- `benchmarks/homophone-repair/README.md` (only if K3 exists).
- `docs/deployment-guide.md` §"The deploy pipeline" and §"Rollback".

## Files to Create / Modify

- Create (not committed): `benchmarks/call-budget/results/arm-cut-{1,2,3}/*`
- Create: `plans/reports/benchmark-<yymmdd-hhmm>-call-budget-cut-arms.md`
- Modify (user-confirmed, on the prod host only): `prod.env` knob values

## Tasks

### Task 4.0 — User gate

- Steps: send the user, in one message: the Phase 03 PR, the knob values for arm `cut`, and the paid-call estimate (replay: turns × projected calls/turn × 3 runs on the prod host; live-translate: 25 utterances per direction × 2 arms × 3 repeats × projected calls/turn). Ask for (a) merge, (b) permission to set the knob values in `prod.env` and recreate `chatofy_prod_api`, (c) approval of the call estimate.
- Verify: the user said yes to all three. Otherwise STOP.

### Task 4.1 — Arm `cut`: 3 replay runs

- Steps:
  1. After the user-approved env change, check that `docker exec chatofy_prod_api printenv TRANSLATE_SPECULATION_OVERLAP` (and `TRANSLATE_SPECULATION_HOMOPHONES`, `TRANSLATE_LIVE_COMMIT_SCALE`) prints the arm value, AND that `docker logs chatofy_prod_api --since 10m 2>&1 | grep 'cost policy:'` shows the arm values (the line is written once per process start).
  2. Run Phase 02 Task 2.3 (fresh token) and Task 2.4 with tags `arm-cut-1..3`.
- Verify: `grep -h "calls/turn" benchmarks/call-budget/results/arm-cut-*/summary.md | wc -l` prints `3`.

### Task 4.2 — Quality check for what the knobs touch

- Steps:
  1. `benchmarks/live-translate/data/` is gitignored and absent locally: build the fixtures first with `build-fixtures.mjs` (its README names the source corpora). Then run `node benchmarks/live-translate/run-arms.mjs --api http://127.0.0.1:4000 --arms cascade --limit 25` with the owner token, passed the way its flag parser accepts (`--token`, or `--email/--password`; read `run-arms.mjs` ~L458-478 and prefer a file or env path so the token is not in argv). It has no `--repeats`: run it 3 times per arm, once set in arm `cut` and once with knobs reset to defaults. These are prod-host calls, counted against the Command Code window, not the DeepSeek-direct cap. Score with `score-adequacy.py`, then compare chrF++ with paired bootstrap (pattern `benchmarks/mt-zh/paired-bootstrap.py`).
  2. If K3h is on (`TRANSLATE_SPECULATION_HOMOPHONES=off`): count `homophones … accepted=N` (N summed) per turn in the arm windows versus the baseline windows. Report the corrections lost per 100 turns.
  3. Break the arm report down further, because each knob costs different turns: K2's hit rate split by continuation versus standalone turns (overlap off makes a continuation guess parked behind `PREDECESSOR_WAIT_MS` block renewals), K4's live-call reduction split by direction (the en clause rule ignores the scale), and live previews per turn beside p50.
- Host: run every arm on the same host as the baseline (DeepSeek direct, polish absent while the Command Code circuit is open). An arm on the proxy against a DeepSeek baseline confounds polish calls and token accounting.
- Pass conditions:
  - chrF++ CI lower bound of (cut − baseline) ≥ −0.5;
  - K3 only: the user is shown the lost corrections number and accepts it (ask; if no, set K3 back to `on` and re-run Task 4.1 once).
- Verify: the report states the CI as a numeric interval, and the lower bound ≥ −0.5.

### Task 4.3 — Decide and record

- Pass conditions, comparing arm means to the baseline means:
  - calls/turn ≤ 0.60 × baseline (AC-C1, before the digest is added);
  - billed tokens/turn ≤ 0.70 × baseline (AC-C2);
  - p50 `translated=` ≤ 1.05 × baseline (AC-L).
- If one fails: switch off the knob with the largest latency or quality cost and re-run Task 4.1 once. If it still fails, STOP (Failure Protocol). Do not loosen a threshold.
- Write the report: baseline vs arm table (mean, min–max), the knob values kept, the quality CI, and the headroom left for the digest (allowed digest calls/turn = 0.60 × baseline − arm calls/turn).
- Verify: the report contains the three pass/fail lines, each marked `PASS`, and the digest headroom number.

### Task 4.4 — Leave prod in the chosen state

- Steps: ask the user to confirm the final `prod.env` knob values (the passing arm). Then propose a small PR that changes the schema defaults to those values. Defaults live in the schema, not in `prod.env` (consolidated env, 20 keys). Merge only with user approval.
- Verify: after deploy, `docker exec chatofy_prod_api printenv | grep -cE '^TRANSLATE_(SPECULATION_OVERLAP|SPECULATION_HOMOPHONES|LIVE_COMMIT_SCALE)='` prints `0` (the values now come from schema defaults; `TRANSLATE_LIVE_MODE` is a separate legitimate key and is not counted), and one replay recording passes Task 2.2's Verify.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
