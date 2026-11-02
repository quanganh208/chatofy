---
phase: 2
title: 'Judge and calibration gate'
status: completed
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 02: Judge and calibration gate

## Goal

Write an MQM-style judge and prove it on known answers (AC-2) before it judges the corpus.

## Judge contract

- Input per turn: `direction`, the prod source, `scribe_source` (or a note that there is none), the 4 previous utterances, and the prod translation.
- Output: JSON validated against a schema, `{errors: [{span, category, severity, origin}], unclear: bool}`.
  - `category`: accuracy (mistranslation, omission, addition), fluency, terminology, or segmentation (the turn starts or ends mid-clause).
  - `severity`: minor, major or critical.
  - `origin`:
    - `asr`: the prod source already differs in meaning from Scribe, and the translation faithfully renders the wrong source;
    - `mt`: the translation is unfaithful to what was said;
    - `segmentation`;
    - `unclear`.
- The judge never writes a corrected translation. The prompt forbids it and the schema has no field for it.
- Temperature 0 if the model allows it, otherwise its lowest. 3 repeats. An error counts when the same `origin` and `category` overlap on the same span in at least 2 of the 3 repeats.
- Gemini REST through `fetch`, with the key from `GEMINI_API_KEY` (comma-separated keys rotate on 429). Pacing follows `PRESETS.gemini.gapMs` in `benchmarks/translation-providers.mjs`.
- The model id is chosen by a `models.list` probe: the strongest Gemini text model the key can call, not `gemini-3.5-flash-lite` (which is the translator on the Gemini path). The id is recorded in every output row, and the scorer refuses a file that mixes models (the `error-analysis` rule).

## Calibration set (deterministic, no model)

`perturb.mjs` derives controls from corpus rows. Each control is labelled with the error it carries:

- **Number swap:** change one digit group in the translation (needs a number).
- **Negation drop or insert:** en `not`/`n't`/`never`; vi `không`/`chưa`/`chẳng`.
- **Name swap:** replace a capitalised name with another name from the same conversation.
- **Clause omission:** drop the longest comma- or `and`/`và`-delimited clause from translations with at least 8 words.
- **Clean:** rows the `conversation-context` term check passed and that neither prod repair touched. These are expected to draw no major or critical errors.

Target: 40 perturbed (10 per kind, or as many as the corpus allows) plus 40 clean. With 3 repeats that is 240 calls.

## Files to create

- `benchmarks/translation-judge/judge.mjs`: `--in`, `--out <fresh dir>` (refuses an existing one), `--repeats`, `--limit-calls`, `--model`. It prints the planned call count and exits 2 above the limit before any request.
- `benchmarks/translation-judge/judge-prompt.mjs`: the prompt text and JSON schema, kept in one place.
- `benchmarks/translation-judge/perturb.mjs`, and `perturb.test.mjs` to check that each kind changes exactly the labelled thing and that rows without a target are skipped.
- `benchmarks/translation-judge/calibrate.mjs`: reads judge output on the calibration set and prints recall per kind, the clean false-flag rate, agreement and the gate verdict. `calibrate.test.mjs` tests it on fixture judge outputs.

## Tasks

1. Probe models and pick the judge; record the id.
2. Smoke-test 5 turns × 1 repeat (`--limit-calls 5`) into a throwaway results dir, and read the raw JSON.
3. Run the calibration set (≤ 240 calls) and run `calibrate.mjs`.
4. If any AC-2 bound fails, look at the misses first. Fix the prompt only if a miss is a prompt defect (for example, the judge treats a dropped negation as fluency), and re-run once. Otherwise switch to the second judge model. If that also fails, stop with NO-GO and go straight to the Phase 03 report.

## Verification

- `node --test benchmarks/translation-judge/*.test.mjs`
- `calibrate.mjs` prints `GATE PASS` with recall ≥ 0.80, clean false-flags ≤ 0.10 and agreement ≥ 0.80.
