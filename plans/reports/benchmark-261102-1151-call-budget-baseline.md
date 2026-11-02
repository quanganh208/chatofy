# Call budget baseline — 2026-11-02

**A turn costs about 10.4 cloud LLM calls and about 6,930 billed tokens.** Two kinds of call stand out:

- **Transcript checks:** homophones and fusion make up 35% of all calls, and only about 3% of them end in a correction the reader sees.
- **Speculative guesses:** 28% of translate calls are guesses that were thrown away.

## Method

- **Tool:** `benchmarks/call-budget/replay-recordings.mts`. It drives the shipped `ConversationSession` through `pushedCaptureDeps`, with `CASCADE_RUNTIME_OPTIONS`. Session options are the ones `/translate` sends: vi↔en two-way, `repairDisplay`, `embedSpeaker` and `splitSpeakers` on, voice off. The client's own `turnKeyedTranscriptReducer` and `blocksToRetranslate` decide which blocks get re-translated.
- **Audio:** the 5 owner recordings in `benchmarks/speaker-id/rulers/conversations/`, 530 s in total. The client cut them into 81 turns per run, 51 of them at the 8 s ceiling.
- **Analysis:** `benchmarks/call-budget/analyze.mjs` over each run's own log window, `docker logs chatofy_prod_api --since/--until`.
- **Runs:** 3, back to back, on prod as deployed at `7003a8d8`, which includes PR #278.
- **Validity:** every run showed `turns = starts = rows = 81` and `unended = 0`, so no organic traffic and no lost turns. The API container did not restart during any run.

### Host

**All three runs ran on DeepSeek direct (`deepseek-flash`), not on the Command Code proxy.**

- The Command Code 5 h window ran out at 04:15Z, during the pilot.
- From then on the shared circuit kept the proxy open-circuited, and every call took the DeepSeek secondary. Counts: `host=commandcode ok=1` = 0, `host=deepseek ok=0` = 0.
- The user approved running the remaining baseline on DeepSeek direct.

Consequence: **the polish does not appear**. It has no fallback and is skipped while the circuit is open. On a normal prod day it runs on the proxy (`gpt-5.6-sol`). The earlier pilot, below, measured it at 0.23 calls per turn and about 2% of billed tokens.

## Results

|                           | run 1       | run 2       | run 3       | mean        |
| ------------------------- | ----------- | ----------- | ----------- | ----------- |
| calls                     | 849         | 837         | 848         | 845         |
| **calls/turn**            | 10.48       | 10.33       | 10.47       | **10.43**   |
| **billed tokens/turn**    | 6,953       | 6,873       | 6,956       | **6,927**   |
| translated p50 / p95 (ms) | 1208 / 1738 | 1296 / 1743 | 1247 / 1872 | 1250 / 1784 |

### By kind and lane (mean of 3 runs)

| kind/purpose          | calls/turn | share |
| --------------------- | ---------- | ----- |
| translate/live        | 3.25       | 31.2% |
| homophones            | 2.53       | 24.3% |
| translate/speculation | 2.20       | 21.1% |
| fusion                | 1.18       | 11.3% |
| translate/final       | 0.64       | 6.2%  |
| translate/block       | 0.57       | 5.4%  |
| respell               | 0.06       | 0.6%  |

The shares at or above 20% are live, homophones and speculation. Homophones and fusion together come to 35.6%.

### Waste

- **Speculation:** 34 hit and 47 miss turns in every run. 184 guesses were made and 150 thrown away, which is 27.6–28.2% of translate calls.
- **Homophones:** 203–204 calls answered per run, with 8–11 corrections accepted.
- **Late corrections:** 9–18 per run arrived after the 250 ms grace and were dropped.
- **Duplicate prompts:** 6.8–7.2% of translate calls sent a prompt byte-identical to an earlier one.

### Pilot (not part of the baseline)

The pilot was one run of an earlier version of the tool, without `repairDisplay` and without block requests, on the proxy before the window ran out. It measured 6.27 calls per turn and 4,927 billed tokens per turn. Polish was 19 calls, 0.23 per turn, about 8.1k of about 395k tokens. These numbers are kept only as the measurement of polish.

## Cut candidates (gates from Phase 03, amended with kongming counsel)

Recounted from the same three log windows, at no cost. Two numbers changed the gates.

- **Fusion is the most useful call in the budget:** 93–97 answered per run, 57–59 accepted (61%). Homophones: 203–204 answered, 8–11 accepted (4.9%). So the combined "(homophones + fusion) accepted ≤ 10%" gate fails at about 22%. Homophones alone pass it.
- **Guesses split cleanly by how the turn ended** (totals over 3 runs, 243 turns):
  - **Hangover turns (90):** the speaker ended them, and every one hits: index 1 ×36, 2 ×36, 3 ×9, 4 ×9.
  - **Ceiling-cut turns (153):** they almost always miss: hit 3 ×12; miss 1 ×36, 2 ×45, 3 ×21, 4 ×39.
  - About 115 of each run's 150 wasted guesses are on ceiling-cut turns.
  - The cause is structural. The speech gate arms a guess at 6.5 s while the speaker is still talking (`speech-gate.ts` `armIfDue`). The cut then flushes more audio, so the guess can never match the end bytes. The 12 hits arm and cut in the same block, so they buy no head start.

| Knob                                       | Gate                                      | Baseline                                        | Verdict                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1 max speculations                        | arm value = 95th-percentile hit index     | 4 even on hangover turns (72/90 ≤ 2, 81/90 ≤ 3) | skip: equals the default                                                                                                                                  |
| K2 no overlapping speculation              | wasted ≥ 20% of translate calls           | 27.8%                                           | **implement**; judge on calls and p50 together, because a blocked would-be hit becomes a final                                                            |
| K3 no transcript checks on speculations    | (homophones + fusion) accepted ≤ 10%      | about 22%                                       | **fails**                                                                                                                                                 |
| K3h no **homophone** check on speculations | homophones ≥ 20% of calls, accepted ≤ 10% | 24.3%, 4.9%                                     | **implement**; hit turns lose about 3–4 homophone corrections per 81 turns                                                                                |
| K4 fewer live previews                     | live ≥ 20% of calls                       | 31.2%                                           | **implement**; report live previews per turn beside p50                                                                                                   |
| K5 prompt memo                             | duplicates ≥ 10% of translate calls       | 7.0%                                            | skip                                                                                                                                                      |
| Polish                                     | ≥ 30% of billed tokens                    | about 2% (pilot)                                | no action                                                                                                                                                 |
| K6 no guess at the 6.5 s arm               | not in the plan                           | about 47 wasted guesses/run, about 11% of calls | **proposed follow-up**: a client change in `packages/realtime-client` that reverses a documented design claim. Raised with the user at Phase 04 Task 4.0. |

Bias to keep in mind: 51 of 81 replay turns are ceiling cuts. That matches the owner's prod sessions, but it inflates live previews and in-turn guesses compared with short-turn speech. Phase 04 arms must run on the same host as this baseline (DeepSeek direct, polish absent).

Run consumption, all measured from the log lines:

- the pilot made 508 calls on the proxy;
- the baseline made 2,534 calls on DeepSeek direct.

The plan's 3,000-call DeepSeek-direct cap was written for benchmarks. These replay calls landed on DeepSeek only because of the failover. **Only 466 calls are left under that cap** if it is read as covering them.

## Unresolved questions

- Does the 3,000-call DeepSeek cap include these 2,534 replay calls? If it does, Phase 05 and Phase 07 need a new budget.
- Should a later re-baseline on the proxy, with polish, be run once the window resets, so that Phase 04 compares like with like?

ultra-source: plans/reports/brainstorm-261102-0930-conversation-state-harness-and-call-budget.md
