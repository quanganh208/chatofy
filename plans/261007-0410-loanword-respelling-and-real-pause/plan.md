---
title: 'Loanword respelling, learned hotwords, real pause'
description: 'Show the intended spelling of English words the vi recognizer garbles, bias later turns toward them, and make Pause stop the clock and the recording.'
status: in-progress
priority: P1
effort: 3d
branch: feat/loanword-respelling-and-real-pause
tags: [api, stt, web, realtime-client, database]
blockedBy: []
blocks: []
created: 2026-10-07
---

# Loanword respelling, learned hotwords, real pause

## Overview

Comes from the quality check of conversation cd64f34f (`plans/reports/quality-261007-1050-deepfake-news-conversation-cd64f34f.md`). The user accepted the contract in `plans/reports/brainstorm-261007-1106-loanword-respelling-and-pause.md`; it holds the outcome, constraints, non-goals, acceptance criteria and measured evidence.

Hard rules:

- No vocabulary lists anywhere. Detection is structural: is this token a possible Vietnamese syllable?
- `sourceText` stays the raw recognizer output.
- Every model proposal passes deterministic guards before it reaches the display.

## Phases

| #   | Phase                                                                                    | Depends on | Status                                    |
| --- | ---------------------------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| 1   | [Structural detector, guards and offline ruler](./phase-01-detector-guards-and-ruler.md) | none       | Completed                                 |
| 2   | [Respelling call on the display path](./phase-02-respelling-call-on-display-path.md)     | 1          | Completed                                 |
| 3   | [Learned per-conversation hotwords](./phase-03-learned-conversation-hotwords.md)         | 2          | Completed                                 |
| 4   | [Real pause: clock, recorder, offsets, paused time](./phase-04-real-pause.md)            | none       | Completed                                 |
| 5   | [Verification, docs and rollout](./phase-05-verification-docs-rollout.md)                | 2, 3, 4    | In progress (rollout awaits confirmation) |

Phase 4 is independent of 1–3 and can be built in parallel; its files do not overlap with theirs.

## Acceptance criteria

- **Replay of cd64f34f:** the display shows "deepfake" in turns 0 and 4, `sourceText` is unchanged, and no other window regresses.
- **Offline ruler on the 50 prod vi turns:**
  - The accepted respellings include the 9 measured right ones (deep fred, defec, ammon, joshup pengo, opena, opera Dario, vini, vnei, vn id).
  - At most 1 is wrong.
  - Correct loanwords (internet, podcast, deadline, hecta, video) are untouched.
- **Guard rejections:** a guard unit test shows each rejection: non-Latin output, a proposal not attested in the translation, letters too far from the span, and a span that is a valid Vietnamese syllable.
- **Prompt injection:** the benchmark has respelling cases and they all pass.
- **Learned hotwords:** a term accepted in turn N is in the STT hotwords of turn N+1 on the same socket, user-declared terms come first, and the cap stays 48.
- **Pause:**
  - While paused, the clock freezes and `MediaRecorder` is paused.
  - The saved `pausedMs` makes the History duration equal active time.
  - A turn after a pause seeks to the right place in the recording.

## Key risks

- A wrong accepted term is reused as a hotword for the rest of the session. It is bounded by guard precision and the hotword cap.
- The respelling prompt is a new model surface on the display path, which §3.14 removed on purpose. The guards plus the injection cases are what make it acceptable.
- The `pausedMs` migration touches prod. Back up the database first.
- Any offset bug after a pause is a seek bug. The parity spec covers it.

## Research

- `research/scout-server-turn-path.md`
- `research/scout-pause-recording-save.md`
- `research/hardcoded-vocabulary-audit.md`: the only keyword rule that touches loanwords is the "ai" note in `prompt-builder.ts:317`. It is out of scope by user decision.

<!-- slug: loanword-respelling-and-real-pause -->
