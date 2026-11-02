---
phase: 3
title: 'Full run, cross-check and verdict'
status: completed
priority: P1
effort: '0.5-1d'
dependencies: [2]
---

# Phase 03: Full run, cross-check and verdict

## Goal

Judge the whole corpus with the calibrated judge, cross-check it with CometKiwi, and write the verdict that picks the next harness piece.

## Files to create or modify

- Create `benchmarks/translation-judge/score.mjs`:
  - error rate per turn by `origin` × severity, and the share of turns with at least one major or critical error;
  - 95% bootstrap CIs resampled by conversation (10,000 resamples, fixed seed);
  - the same split by direction and by turn length (≤ 4 words vs longer);
  - the `unclear` and `scribe_missing` rates.

  It writes to stdout.

- Create `benchmarks/translation-judge/score.test.mjs` on fixture rows.
- Create `benchmarks/translation-judge/cometkiwi.py`: `Unbabel/wmt22-cometkiwi-da` (CC-BY-NC; fine for a non-commercial thesis), run in the `benchmarks/live-translate` environment, as `benchmarks/mt-zh/score.py` is (`cd benchmarks/live-translate && uv run --frozen --with "setuptools<81" python -I ../translation-judge/cometkiwi.py …`). It prints the Spearman correlation between per-turn judge severity points (minor 1, major 5, critical 10) and Kiwi. It runs on CPU and makes no paid calls.
- Create `plans/reports/benchmark-<date>-translation-judge-ruler.md`.
- Modify `docs/development-journey.md` with a dated section.
- Modify `benchmarks/translation-judge/README.md` with the results summary and the commands that reproduce it.

## Tasks

1. Full run: about 150 turns × 3 repeats ≈ 450 calls, with `--limit-calls 500`. Split across days or keys if the quota requires it. Resume by conversation, never by re-judging finished rows into the same dir.
2. Score, then run CometKiwi.
3. Read 15 judged turns with major or critical errors against their sources to sanity-check `origin`. Report how many look right; this is the reader's spot check, not a gate.
4. Decision rule for the verdict:
   - `asr` ≥ 50% of major or critical errors means STT work comes first, and the polish-lane review loop is not supported.
   - `mt` ≥ 40% with a CI whose lower bound is above 20% supports a polish-lane review loop as the next plan.
   - `terminology` ≥ 30% within `mt` supports domain packs.
   - `segmentation` ≥ 30% points at the committer, not the translator.
   - Otherwise the verdict is "no single lever", with the table as the record.
5. Write the report (outcome first, the table, calibration numbers, model ids, call counts, limits, unresolved questions) and the journey section.
6. Update memory with the verdict: the judge model, its calibration numbers, and that the ruler exists and how to re-run it.

## Verification

- `node --test benchmarks/translation-judge/*.test.mjs` and the pytest suite pass.
- `node benchmarks/translation-judge/score.mjs results/<run>` reproduces the report's table.
- The report and the journey section cite the same numbers.
- `git status` shows no data or results files staged.
