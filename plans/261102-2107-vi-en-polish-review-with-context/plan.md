---
title: 'vi→en review pass: give the polisher context, prove it on the ruler'
description: 'Replay candidate review passes over the judged prod corpus, judge each with the calibrated ruler, and ship the arm that lowers vi→en translation errors without hurting en→vi.'
status: in-progress
priority: P1
effort: '2-2.5d'
branch: quanganh208/feat/translation-judge-ruler
tags: [translation, polish, benchmarks, measurement]
blockedBy: []
blocks: []
created: 2026-11-02
---

# vi→en review pass: give the polisher context, prove it on the ruler

## Overview

The ruler (`plans/reports/benchmark-261102-1911-translation-judge-ruler.md`) found that 23.7% of vi→en turns carry a serious translation error. The errors are semantic: "Ai" (AI) read as "whoever", invented clauses, self-talk turned into a question. On en→vi the same rate is 1.3%.

A second pass already exists. `TurnPolisher` sends every finished turn to `gpt-5.6-sol` on Command Code, with a prompt that already asks it to fix mistranslations. But it gets **no context**: both call sites in `translation-session.service.ts` (lines 1169 and 1610) omit `context`, so the prompt's `<context>` block is always empty.

This plan replays review passes offline on the 162 judged turns, judges each pass with the same calibrated ruler, and ships only a pass that wins.

Source contract: `plans/reports/brainstorm-261102-2107-interpreter-harness-after-ruler.md`.

## User decisions (settled 2026-11-02; do not re-ask)

| Decision                        | Value                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Reviewer model for the arms     | `deepseek-v4-pro` on DeepSeek direct, run now (not wait for `gpt-5.6-sol` on 2026-11-04).  |
| Live behaviour when quota spent | Keep the draft, as today. No fallback polish host.                                         |
| Judge                           | `claude-opus-5-5`, effort high, 3 repeats, majority consensus, same as the baseline run.   |
| Judge budget                    | All judge spend shares the $100 cap of `ANTHROPIC_API_KEY` ($8.63 spent before this plan). |
| Grading                         | LLM judge only; no hand grading, no reference translations.                                |

## Phases

| #   | Phase                                                        | Status                | Effort | Depends |
| --- | ------------------------------------------------------------ | --------------------- | ------ | ------- |
| 01  | [Review-arm replay rig](phase-01-review-arm-replay-rig.md)   | completed             | 0.5d   | —       |
| 02  | [Judge arms and compare](phase-02-judge-arms-and-compare.md) | completed (GO, arm 2) | 0.5–1d | 01      |
| 03  | [Ship the winning pass](phase-03-ship-the-winning-pass.md)   | in-progress           | 0.5–1d | 02 (GO) |

## Acceptance criteria

1. **AC-1 rig:** the rig writes, per arm, one reviewed translation per corpus turn. The rows have the same shape as `data/turns.scribed.jsonl`, plus `arm`, `rewritten`, `ms` and `costUsd`. The rig uses the prod prompt builders from `@chatofy/ai-providers` and does not copy them.
2. **AC-2 win:** an arm lowers the share of vi→en turns with a serious `mt` error below arm 0 (stored translations). The 95% paired bootstrap interval of the difference, resampling conversations, must exclude 0.
3. **AC-3 guard:** the same arm does not raise en→vi serious errors. The point estimate of the difference must be ≤ +2 points.
4. **AC-4 witness:** the arm's mean CometKiwi score is not below arm 0's.
5. **AC-5 latency and cost:** the arm's p95 reviewer latency is under `POLISH_TIMEOUT_MS` (8 s). Cost per turn and rewrite rate are recorded.
6. **AC-6 ship (only on GO):**
   - the polisher receives conversation context at both call sites, with tests;
   - API unit tests, typecheck and lint pass;
   - after deploy, a prod replay shows `llm kind=polish` calls with `ok=1` once Command Code's window is open.
7. **AC-7 record:**
   - a report in `plans/reports/`;
   - a `docs/development-journey.md` entry;
   - the GO/NO-GO is written down even when no arm wins.

## Spend limits

- **Judge:** about $6.4 per arm. Arms 1–2 cost about $13, and the optional arm 3 another $6.4. `judge.mjs --budget-usd 100` already stops at the shared cap.
- **Reviewer (DeepSeek):** the account held **$1.46** on 2026-11-02, and the same key serves prod translation while Command Code is spent.
  - The rig gets its own `--budget-usd` cap, default $0.50.
  - It refuses to start when the balance is under $1.00, so prod keeps its headroom.
  - Ask the user to top up before running arm 3 or re-runs.

## Risks

- **Self-preference does not apply.** The reviewer is DeepSeek and the judge is Claude. The judge-independence decision of the ruler plan still holds, because the judge is not the reviewer.
- **Model mismatch on ship.** The arms prove a pass on `deepseek-v4-pro`, but prod polishes on `gpt-5.6-sol`. Phase 03 ships only the context change, which is model-independent. It re-runs the winning arm on `gpt-5.6-sol` after 2026-11-04 to confirm, about $6.4 of judge spend.
- **Small slice.** There are 76 vi→en turns. The paired design (same turns, same judge) narrows the interval. A NO-GO from a wide interval is recorded as "not shown", not as "no effect".
- **Over-editing.** The en→vi guard and the rewrite rate catch a pass that rewrites correct lines.

## Outcome so far (2026-11-02)

- **AC-1 met:** the rig is `review-arms.mjs` and the paired comparison is `compare.mjs`. 21 node tests pass.
- **AC-2 met for arm 2:** vi→en serious `mt` fell from 23.7% to 1.3% (−22.4 points, interval [−40.4, −11.6]).
- **AC-3 met:** en→vi serious errors went from 10.0% to 8.8%.
- **AC-4 met:** CometKiwi went from 0.753 to 0.768.
- **AC-5 met:** p95 2.5 s; $0.0009 a turn; 77% of lines rewritten.
- **AC-6 partly met.** The context change is committed locally, and 1701 API tests, typecheck and lint pass. Still pending:
  - push, PR, deploy (awaiting the user);
  - the re-run on `gpt-5.6-sol` after 2026-11-04;
  - the prod log check.
- **AC-7 met:** the report is `plans/reports/benchmark-261102-2130-vi-en-review-arms.md`, plus a journey entry.
- **Spend:** judge $17.49 of $100 in total. The reviewer cost about $0.26.
