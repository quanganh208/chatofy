---
phase: 11
title: 'benchmarks/error-analysis — corpus and before/after'
status: complete
priority: P2
effort: '6h'
dependencies: [3]
---

# Phase 11: benchmarks/error-analysis — corpus and before/after

## Goal

Author the labelled bilingual corpus the harness has never had, and measure
whether the glossary actually moves the error taxonomy — the only evidence this
delivery produces that translation gets BETTER rather than merely not worse.

## Files to Create / Modify

- Create: `benchmarks/error-analysis/rows.jsonl` (~40 rows, hand-written references)
- Create: `benchmarks/error-analysis/glossary.json`
- Create: `benchmarks/error-analysis/translate-rows.mjs`
- Create: `benchmarks/error-analysis/results/before.md`, `results/after.md` (generated)
- Modify: `benchmarks/error-analysis/README.md`

## Tasks & Steps

1. Author `rows.jsonl` — ~40 rows drawn from real conversation material, both
   directions, each `{ id, direction, source, hypothesis, reference, label? }`
   where `direction` is `'vi_to_en' | 'en_to_vi'`.
   **`direction` is REQUIRED and explicit**, not inferred. The step below
   originally said the runner infers direction from "its `source` language
   field", but no such field exists in this schema and language detection on a
   short utterance is exactly the guess this corpus exists to avoid. It is also
   ignored by `analyze.mjs`, which reads only `source`, `hypothesis`,
   `reference` and `label` — so adding it costs nothing and breaks no
   committed tool.
   `reference` is human-written and **required on every row**: the harness
   refuses to run otherwise rather than scoring the subset that has one
   (`analyze.mjs:31-38`), for the same reason `live-translate/score-adequacy.py`
   refuses — "a rate computed over whichever rows happened to be complete is a
   number nobody chose".
   `hypothesis` here is the BEFORE output, recorded once, so that the README's
   own `node analyze.mjs rows.jsonl` command works out of the box.
   Bias the rows toward what a glossary can fix: proper nouns, institutional
   terms, domain jargon. Roughly 20 `vi → en` and 20 `en → vi`.
2. Author `glossary.json` — the `{vi, en}` pairs a user would plausibly have
   written for this material, at most `MAX_GLOSSARY` = 24 of them.
3. Write `translate-rows.mjs`, modelled on `benchmarks/prompt-injection/run.mjs`:
   - loads `GeminiTranslationProvider` from
     `packages/ai-providers/dist/index.js` — the built package, not `src`,
     exactly as `classify.mjs:14-17` already does;
   - takes `<rows.jsonl> [--glossary <file>] [--model m] [--gap-ms n]`, validated
     rather than coerced (`run.mjs:28-56` — `Number('2x')` is NaN and a typo
     would otherwise report a clean sweep);
   - reads each row's REQUIRED `direction` field; refuses the run if any row lacks one;
   - **writes to stdout only.** The redirect belongs to the caller, as it does
     for `analyze.mjs` — a scorer that writes into recorded results is how a
     smoke run silently corrupts a real one.
   - paces itself at the default 4300 ms gap.
4. Produce both arms, on ONE model so the comparison is not confounded by the
   ladder, and **not on the model phase 3 spent its budget on the same day**:

   ```bash
   pnpm --filter @chatofy/ai-providers build
   mkdir -p benchmarks/error-analysis/results
   node benchmarks/error-analysis/translate-rows.mjs benchmarks/error-analysis/rows.jsonl \
     --model gemini-3.1-flash-lite \
     > benchmarks/error-analysis/results/before.jsonl
   node benchmarks/error-analysis/translate-rows.mjs benchmarks/error-analysis/rows.jsonl \
     --glossary benchmarks/error-analysis/glossary.json \
     --model gemini-3.1-flash-lite \
     > benchmarks/error-analysis/results/after.jsonl
   node benchmarks/error-analysis/analyze.mjs benchmarks/error-analysis/results/before.jsonl \
     > benchmarks/error-analysis/results/before.md
   node benchmarks/error-analysis/analyze.mjs benchmarks/error-analysis/results/after.jsonl \
     > benchmarks/error-analysis/results/after.md
   ```

   Cost: 40 × 2 = 80 requests, one model, ~6 minutes.

5. Record the comparison in the phase report: the `tone-or-diacritic` and
   `lexical-or-semantic` counts before and after, and the unlabelled count.
6. Update `README.md` with the new files, the `translate-rows.mjs` command, and
   **the honest caveat, in these words or close to them**: forty chosen rows is
   weak evidence, and saying so is better than reporting it as if it were not.
   `lexical-or-semantic` remains a holding pen, not a finding — geographic,
   factual and register errors cannot be decided by comparing strings, so the
   count that matters is how many rows are sitting there **unlabelled**
   (`classify.mjs:191` reports it), and that number is part of the result rather
   than a footnote to it.
7. `classify.mjs` and `classify.test.mjs` are **not** modified. No new category
   is introduced; the glossary's effect is a movement in the existing ones.

## Verification

- `node --test benchmarks/error-analysis/classify.test.mjs`
  → prints `pass` for every test and `fail 0` (the classifier is unchanged and
  must stay so).
- `node benchmarks/error-analysis/analyze.mjs benchmarks/error-analysis/rows.jsonl | head -5`
  → its third line reads `40 rows · N with a difference · M exact` with
  `N + M = 40`. A non-zero "have no reference" message means the corpus is
  incomplete and the phase is not done.
- `wc -l benchmarks/error-analysis/results/before.jsonl benchmarks/error-analysis/results/after.jsonl`
  → both print **40**.
- `grep -c 'tone-or-diacritic' benchmarks/error-analysis/results/before.md benchmarks/error-analysis/results/after.md`
  → both print a number ≥ 1, and the two counts in those tables are transcribed
  into the phase report side by side.

---

## Result — 2026-09-17

Both arms on `gemini-3.5-flash-lite`, 40 rows each, 80 requests total.

**Deviation from step 4, stated rather than slipped in:** the plan named
`gemini-3.1-flash-lite` so as not to reuse the model phase 03 spent its budget
on. Phase 03 spends BOTH models, so that instruction could not be followed as
written; by the time these ran, 3.1 was returning quota cooldowns
(4 errors in the gate's second run) and 3.5 had zero. The requirement that
actually matters — both arms on ONE model, so the ladder cannot confound the
comparison — is met.

|                                        | before | after  |
| -------------------------------------- | ------ | ------ |
| exact                                  | 3      | 5      |
| `casing-punctuation`                   | 4      | 9      |
| **lexically correct (exact + casing)** | **7**  | **14** |
| `lexical-or-semantic`                  | 31     | 25     |
| **unlabelled in the holding pen**      | **31** | **25** |
| `invention`                            | 1      | 0      |
| `number-mismatch`                      | 1      | 1      |

The glossary moved six rows out of `lexical-or-semantic`, and the rows it moved
landed in categories of LOWER severity — `casing-punctuation` is marked cosmetic
and `exact` is no error at all. The count of rows whose WORDS are right doubled,
7 to 14 of 40.

Two examples of the mechanism:

```
v18  ref    I would like to book a deluxe room
     before I would like to book a luxury room
     after  I would like to book a deluxe room

v05  ref    I have my thesis defense next week
     before Next week I am defending my thesis.
     after  I have my thesis defense next week
```

**The honest caveat stands.** Forty chosen rows biased toward what a glossary can
fix is weak evidence, and the count that matters is the unlabelled one: 25 rows
still sit in a holding pen whose contents no string comparison can classify.
This says the change did not hurt the baseline and that it helps on this
material. It does not put a number on how much better translation got.

## One verification criterion not met

`grep -c 'tone-or-diacritic'` prints **0** for both reports, not the ≥1 the phase
asked for. The corpus produced no rows in that category and `analyze.mjs` lists
only categories that have rows. An empty category is a result; rows were not
added to force it into existence.
