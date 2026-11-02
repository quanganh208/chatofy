---
title: 'LLM-judge ruler for translation quality'
description: 'Measure where prod translation errors come from (misheard, mistranslated, mis-cut, term) with a calibrated Claude judge and an independent Scribe transcript, so the next harness piece is chosen on evidence.'
status: completed
priority: P1
effort: '2.5-3d'
branch: quanganh208/feat/translation-judge-ruler
tags: [benchmarks, translation, stt, measurement]
blockedBy: []
blocks: []
created: 2026-11-02
---

# LLM-judge ruler for translation quality

## Overview

Chatofy already has most of a translation harness: hints, 4-utterance context, learned terms, a polisher, display repair, a cost policy. What it lacks is a ruler, the translation counterpart of a test suite. The digest oracle (PR #289) showed that terms have no headroom, and nobody knows where the remaining errors are.

This plan builds a measurement-only benchmark, `benchmarks/translation-judge/`. An independent LLM judge annotates errors on real prod turns. Each turn's audio is re-transcribed by Scribe, so "misheard" can be separated from "mistranslated". The judge is calibrated on deterministic perturbations before any table is trusted.

Source contract: `plans/reports/brainstorm-261102-1718-llm-judge-translation-ruler.md`.

## User decisions (settled 2026-11-02; do not re-ask)

| Decision                         | Value                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Who grades                       | An LLM judge. The user does not grade by hand and writes no references.                                                      |
| Model-written references         | Still forbidden. The judge annotates errors; it never writes a translation.                                                  |
| Judge independence               | Not DeepSeek (translator) and not the polisher model.                                                                        |
| Judge model (changed 2026-11-02) | `claude-opus-5-5` on the Anthropic API, effort `high`. Gemini free tier allows only 20 requests a day per model per project. |
| Judge budget                     | At most $100 of the account's $200 credit, enforced by `judge.mjs --budget-usd` across every run.                            |
| Corpus size                      | All 18 of the owner's recorded conversations: 191 turns, 162 with a translation. 29 have no stored translation.              |
| Source truth for hearing         | An ElevenLabs Scribe v2 transcript of the conversation recording.                                                            |

## Phases

| #   | Phase                                                                             | Status    | Effort | Depends |
| --- | --------------------------------------------------------------------------------- | --------- | ------ | ------- |
| 01  | [Corpus with Scribe sources](phase-01-corpus-with-scribe-sources.md)              | completed | 1d     | —       |
| 02  | [Judge and calibration gate](phase-02-judge-and-calibration-gate.md)              | completed | 1d     | 01      |
| 03  | [Full run, cross-check and verdict](phase-03-full-run-cross-check-and-verdict.md) | completed | 0.5–1d | 02      |

## Outcome (2026-11-02)

- AC-1 met: 162 judged turns from 17 conversations.
- AC-2 met: recall 93.3%, clean flags 2.5%, agreement 100%.
- AC-3 met: the error table is in the report.
- AC-4 met: CometKiwi vs judge severity, Spearman −0.591 over 162 turns (mean Kiwi 0.753; 0.806 on judge-clean turns).
- AC-5 met: the next lever is a vi→en review loop in the polish lane; STT remains a lever. Report: `plans/reports/benchmark-261102-1911-translation-judge-ruler.md`.
- AC-6 met: 17 node tests and 9 pytest tests pass.

## Acceptance criteria

1. **AC-1 corpus:** at least 150 judged turns from at least 5 prod conversations that have recordings, each with prod source, Scribe source, prod translation and 4 previous utterances.
2. **AC-2 calibration**, on the chosen judge model:
   - it catches at least 80% of deterministic perturbations;
   - it flags major or critical errors on at most 10% of the clean controls;
   - its error labels agree in at least 2 of 3 repeats on at least 80% of turns.

   If the judge fails, try one other judge model. If that also fails, the plan stops with NO-GO for the ruler and no error table is published.

3. **AC-3 table:** error rate per turn by source (ASR / MT / segmentation / term) and severity, with 95% bootstrap CIs resampled by conversation.
4. **AC-4 cross-check:** a Spearman correlation between judge severity and CometKiwi score per turn, reported beside the table. It is not a gate.
5. **AC-5 verdict:** a report in `plans/reports/` and a dated section in `docs/development-journey.md`. Both name which harness piece the table supports (a polish-lane review loop, domain packs, STT work, or nothing) and why.
6. Unit tests for slicing, perturbation, agreement and scoring pass with `node --test` and `uv run pytest`.

## Constraints

- Measurement only. Nothing is imported by the app, nothing changes on prod, and no call is added to the live path.
- Prod access is read-only (`docker exec chatofy_prod_postgres psql`, R2 public URL), following `benchmarks/stt/scripts/prod-audio-arms/README.md`.
- No audio, transcript, prod id or judge output is committed. Everything lives under the gitignored `data/` and `results/`.
- Sending recordings to Scribe needs the maintainer's approval per run. Each script that sends audio refuses without `--consent-recorded`, as `benchmarks/lid` does.
- Paid or quota calls print the planned count and refuse above `--limit-calls` before the first request.
- Scorers write to stdout or a fresh results dir, and never into a recorded result (memory: `benchmark-scripts-write-into-recorded-results`).
- Do not run anything against the prod STT sidecar.

## Non-goals

- Building the review loop, domain packs or any prompt change.
- A human-graded set or reference translations.
- A dashboard or CI gate on judge scores.

## Risks

| Risk                                            | Mitigation                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The judge's Vietnamese is weak                  | AC-2 recall gate; a second judge model before giving up.                                                                                                |
| Scribe also mishears (fast handoffs)            | The judge gets both transcripts and may answer `unclear`; report the `unclear` rate.                                                                    |
| Turn slicing by `offsetMs` drifts at boundaries | Unit-test the slicer; pad ±150 ms (memory: final STT audio has a 150 ms tail); the judge sees neighbouring turns.                                       |
| Gemini free quota (500/day per model)           | About 700 judge calls in total. Calibration runs on day 1 and the full run on day 2, or use multiple keys through the comma-separated `GEMINI_API_KEY`. |
| Guest voices in recordings                      | Use only conversations whose speakers the maintainer can vouch for; record that in the README consent section.                                          |
