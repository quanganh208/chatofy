---
title: 'Conversation state harness and per-turn LLM call budget'
description: 'Measure every cloud LLM call per turn, cut the wasteful ones behind knobs, then add a gated conversation digest so later turns know what the conversation is about.'
status: pending
priority: P1
effort: '6-8d'
branch: quanganh208/feat/conversation-state-call-budget
tags: [api, ai-providers, translation, benchmarks, cost]
blockedBy: []
blocks: []
created: 2026-11-02
---

# Conversation state harness and per-turn LLM call budget

## Overview

Two goals, one delivery (user request 2026-11-02):

1. **Understand the conversation.** Each connection keeps a structured `ConversationState`
   (domain ≤ 4 words, entities, term pairs, register), refreshed by a background digest
   every K finished turns. It reaches the prompt only through channels that are already
   capped and measured.
2. **Cost less per turn.** Cut cloud LLM calls and tokens per turn by ≥ 40% / ≥ 30%,
   counting the new digest calls inside the total.

Order is fixed: **measure → cut → understand.** Nothing ships without the measurement gate
named in its phase.

Source contract: `plans/reports/brainstorm-261102-0930-conversation-state-harness-and-call-budget.md`
(ultra winner, picked 5/5). Read it before Phase 01.

## User decisions (settled 2026-11-02; do not re-ask)

| Decision                                       | Value                                                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation understanding wanted              | Yes. The rolling digest is in scope, gated.                                                                                                                                                           |
| Digest terms enter the translation prompt      | Yes, in **both** one-way and two-way. This reverses the recorded decision "learned terms never enter the translation prompt" (journey §"Garbled loanwords…", 07/10/2026).                             |
| References for the ordered-conversation corpus | The **user writes them**. The harness exports draft rows; it refuses to run while any row lacks a human `reference`. Model-written references are forbidden.                                          |
| Thresholds                                     | calls/turn ≤ 60% of baseline; billed tokens/turn ≤ 70%; chrF++ CI lower bound ≥ −0.5; turn p50 `translated=` ≤ +5%.                                                                                   |
| Paid measurement budget                        | DeepSeek **direct** (`api.deepseek.com`, key `OPENAI_COMPATIBLE_API_KEY` in `chatofy_prod_api`), cap **3,000 calls** total across all benchmark runs. State the expected call count before every run. |

## Phases

| #   | Phase                                                                                 | Depends on                | Status                              |
| --- | ------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| 01  | [Instrument every cloud LLM call](./phase-01-instrument-llm-calls.md)                 | —                         | Done (PR #278)                      |
| 02  | [Baseline on prod](./phase-02-baseline-on-prod.md)                                    | 01                        | Done (10.43 calls/turn)             |
| 03  | [Cost knobs, default off](./phase-03-cost-knobs.md)                                   | 02                        | Done (PR #280)                      |
| 04  | [Replay arms and choose cuts](./phase-04-replay-arms-and-cut-selection.md)            | 03                        | Done (5.67 calls/turn)              |
| 05  | [Ordered-conversation corpus](./phase-05-ordered-conversation-corpus.md)              | 01 (can run beside 03–04) | Rows exported; waits for references |
| 06  | [ConversationState and digest, flag off](./phase-06-conversation-state-and-digest.md) | 04, 05                    | Pending                             |
| 07  | [Digest measurement and rollout](./phase-07-digest-measurement-and-rollout.md)        | 06                        | Pending                             |

## Acceptance criteria (whole plan)

- [ ] **AC-C0** Every cloud LLM call writes one `llm …` log line with kind, model, ms, tokens. Unit specs pass. (Phase 01)
- [ ] **AC-C1** Replay calls/turn of the shipped configuration ≤ 60% of the Phase 02 baseline, digest included. (Phases 04, 07)
- [ ] **AC-C2** Billed tokens/turn ≤ 70% of baseline, digest included. (Phases 04, 07)
- [ ] **AC-L** Turn p50 `translated=` ≤ baseline × 1.05; the digest never sits on a turn's await path. (Phases 04, 07)
- [ ] **AC-Q1** `benchmarks/live-translate` chrF++ paired-bootstrap CI lower bound ≥ −0.5 versus baseline, 3 runs. K3 (no correction on speculations) is judged by corrections lost per 100 turns and the user's acceptance. `benchmarks/homophone-repair` / `recognizer-fusion` apply only to a cut that changes `correctTranscript` itself. (Phase 04)
- [ ] **AC-Q2** On the ordered corpus, digest arm beats baseline on term-render accuracy (CI excludes 0, 3 repeats), and the gain in turn bucket 16+ ≥ the gain in bucket 1–5. (Phase 07)
- [ ] **AC-Q3** The anchoring control set: wrong-sense flips on ≥ 5-word turns do not increase. (Phase 07)
- [ ] **AC-S** `benchmarks/prompt-injection` 100% at `--repeats 3`, including new digest-poisoning rows. Glossary adherence ≥ baseline − 1. (Phase 07)

## Paid-call ledger

Two separate budgets. Every report states "this run / cumulative" for the one it spends.

**DeepSeek direct, cap 3,000** (benchmarks). N = corpus rows (≥ 60):

| Run                                               | Calls                  |
| ------------------------------------------------- | ---------------------- |
| Phase 02 Task 2.1 usage probe                     | 1                      |
| Phase 05 baseline + oracle, 3 repeats             | 6N                     |
| Phase 07 digest arm, 3 repeats                    | 3N + 3·⌈N/5⌉           |
| Phase 07 `prompt-injection/run.mjs`, 3 repeats    | ≈ 215 (+3 per new row) |
| Phase 07 `prompt-injection/digest.mjs`, 3 repeats | ≈ 75                   |
| Phase 07 glossary adherence, 2 runs               | 86                     |

N = 60 gives ≈ 1,060; N = 100 gives ≈ 1,450. That fits under 3,000 with one Phase 07 re-run. Stop and ask before any run that would cross 3,000.

**Prod translation host (Command Code proxy, 5 h window ≈ 5.3k calls)** for replays and live-translate. Each run is approved by the user with its estimate (Phase 02 Task 2.0, Phase 04 Task 4.0, Phase 07 Task 7.5). Phase 04 alone is ≈ 2,400 calls (3 × ~60 turns × ~5, plus live-translate). Never run arms back-to-back inside one window, and stop at the first 429 that mentions a usage limit.

## Global constraints (every phase)

- No new blocking LLM call on the live path. Context and digest are read, never awaited.
- Untrusted text reaches a prompt only through `asTranscriptData` with the existing caps: glossary side ≤ 4 words (`MAX_GLOSSARY_TERM_WORDS`), ≤ 24 pairs, topic ≤ 200 chars.
- Every knob's default equals today's behavior. Changing `prod.env`, recreating containers, or deploying is a **separate user confirmation** every time.
- Never benchmark against the prod STT sidecar (`chatofy_prod_local_stt`). Replays go through the prod API as a client, which is how a user uses it.
- Never print secrets. Tokens go to chmod-600 files in the session scratchpad.
- Commits: conventional format, no AI attribution lines, no plan or phase IDs in code, comments, test names or commit messages.
- Node: put Node v26 on PATH before `pnpm` (shell default is v24 without pnpm).

## Handover

Handover-ready for a downstream executor (`--advice` contract). Each phase lists tasks with
target files, steps, success criteria and a mechanical `Verify`, and carries its own
Failure Protocol. Stopping on a failed check is intended behavior, not a stall.
