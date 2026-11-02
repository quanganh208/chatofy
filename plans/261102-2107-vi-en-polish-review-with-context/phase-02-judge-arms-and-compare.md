---
phase: 2
title: 'Judge arms and compare'
status: completed
effort: '0.5-1d'
---

# Phase 02: Judge arms and compare

## Goal

Judge every arm with the same calibrated judge, compare it turn by turn with arm 0, and write the GO/NO-GO decision.

## Context

- **Arm 0 needs no new judging.** It is `results/full-claude-opus-5-5`: same turns, same judge, 3 repeats.
- **Judge settings stay fixed:**
  - `judge.mjs --model claude-opus-5-5 --effort high --repeats 3`;
  - the budget is the shared $100 cap, with $8.63 spent;
  - the calibration (`cal-*` runs) holds for the same judge settings, so it is not re-run.

## Files

- **Create `benchmarks/translation-judge/compare.mjs`:**
  - inputs: `--base results/<arm0> --arm results/<armN> --turns <arm turns file>`;
  - per turn, it reads the consensus of base and arm through `consensus.mjs`;
  - reports, per direction:
    - the serious-`mt` turn share, base vs arm;
    - the serious-any turn share, base vs arm;
    - the paired difference, with a 95% bootstrap interval resampling conversations (reuse `mulberry32` and the bootstrap pattern from `score.mjs`);
  - also reports turns fixed (base serious → arm clean) and turns broken (base clean → arm serious), the rewrite rate, the p95 `ms`, and the cost per turn;
  - writes to stdout only.
- **Modify `benchmarks/translation-judge/cometkiwi.py`:** add `--turns-override` so Kiwi scores an arm's translations. Report the mean Kiwi per arm.
- **Modify `benchmarks/translation-judge/judge.test.mjs`:** add `compare` tests on fixtures: a paired difference, and fixed and broken counts.
- **Create a report** `plans/reports/benchmark-<date>-vi-en-review-arms.md` with the table and the GO/NO-GO.

## Steps

1. Judge arm 1: `node judge.mjs --in data/arms/arm-1-deepseek-v4-pro.jsonl --out results/arm1-claude-opus-5-5 --model claude-opus-5-5 --effort high --repeats 3 --concurrency 4`. Then do the same for arm 2.
2. Run `compare.mjs` for arm 1 against arm 0 and arm 2 against arm 0. Then run CometKiwi on each arm.
3. Decide on arm 3. If arm 2 removed fewer than half of arm 0's vi→en serious-`mt` turns, build arm 3 in `review-arms.mjs` (call 1 lists meaning errors as JSON, call 2 rewrites only when call 1 found any), run it, judge it and compare it. This needs a DeepSeek top-up if the balance would fall under $1.00.
4. Apply the gate to the best arm: AC-2 win, AC-3 guard, AC-4 Kiwi, AC-5 latency.
5. Spot-read 10 turns the arm "fixed" and every turn it "broke", and check that the judge's reading is plausible.

## Validation

- `compare.mjs` tests pass.
- Every judged arm has 0 failed calls, or failures re-run with `--resume`.
- Total judge spend after this phase is under $35.

## Output

A GO names the arm and the exact change phase 03 ships. A NO-GO stops the plan at this phase. It records why, and says which arm came closest and what the interval was.
