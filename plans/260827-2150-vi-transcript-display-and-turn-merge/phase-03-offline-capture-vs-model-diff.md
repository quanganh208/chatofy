---
phase: 3
title: 'Offline capture-vs-model diff'
status: pending
priority: P2
effort: '0.25d'
dependencies: []
---

# Phase 3: Offline capture-vs-model diff

## Overview

Settle where the head of the utterance went. "Ghi nhận lúc" is absent from turn
1 of the report, and two very different causes predict the identical transcript.
One command distinguishes them.

## Why this phase exists

Two live hypotheses, from the diagnosis:

- **Capture chain.** `PRE_ROLL_MS = 320` protects only ~0.32s before speech is
  confirmed, and `MIN_SPEECH_MS = 120` must elapse before a turn opens. A soft
  utterance-initial syllable can fall outside that window and never be sent.
- **Recognizer.** Zipformer deleting a leading phrase on out-of-domain audio.

They have opposite fixes and neither is worth attempting blind. The same run
also settles half of the `ngập`→`ngọt` question: whether the recognition errors
are the model or the browser capture chain (AGC, noise suppression, far-field),
since the benchmark's 5.38% WER was measured on clean close-mic VIVOS audio.

## Requirements

- Functional: capture the raw audio of one reproduction turn as sent to the
  sidecar, decode it offline through the same engine, diff against the live
  transcript.
- Non-functional: no app behavior change. Any capture hook is temporary and
  reverted, or gated behind an existing debug path.

## Architecture

The sidecar already accepts any container at `POST /transcribe` and decodes with
PyAV, so an offline run needs no new decode path — the same bytes the live turn
sent, replayed.

Diff on three axes: is the head present, are the substitutions the same, is the
duplication (`đi gặp gặp`) reproduced.

## Related Code Files

- Read only: `services/local-stt/app.py`, `services/local-stt/audio/decode.py`
- Read only: `packages/realtime-client/src/audio/capture-pump.ts` (`PRE_ROLL_MS`, pre-roll ring buffer)
- Temporary only: whatever capture hook is needed to persist one turn's audio; reverted before the phase closes
- Create: gate report in `plans/reports/`

## Implementation Steps

1. Reproduce the passage once with the turn's outbound audio persisted to disk.
2. Replay that exact audio through the sidecar offline (`curl -F file=@turn.webm -F language=vi`).
3. Diff offline transcript vs the live one.
4. Record the verdict:
   - **Head present offline** ⇒ capture chain. `PRE_ROLL_MS` is the lever. Note it
     for a future plan; it is a non-goal here because it carries a latency price.
   - **Head absent offline** ⇒ recognizer deletion. Nothing in this plan fixes it;
     it becomes a Phase 6 input and a thesis caveat.
5. Same for the substitutions: reproduced offline ⇒ model; only live ⇒ capture chain.
6. Revert any temporary capture hook. Confirm the working tree is clean.

## Success Criteria

- [ ] One reproduction turn's raw audio captured and replayed offline
- [ ] Head-present verdict recorded with the two transcripts side by side
- [ ] Substitution verdict recorded (model vs capture chain)
- [ ] Temporary capture hook reverted; `git status` clean
- [ ] Verdict written to `plans/reports/` and referenced from this phase

## Risk Assessment

- **The reproduction does not reproduce.** Live ASR is not deterministic across
  sessions and the defect may not recur on the take that gets captured. Signal:
  the captured turn's live transcript has no missing head. Response: repeat up to
  3 takes, then record "not reproduced" honestly rather than reasoning from the
  original screenshot.
- **The capture hook changes what it measures.** Persisting audio on the hot path
  could alter timing enough to move the very boundary under investigation.
  Signal: turn boundaries differ from an unhooked run. Response: tee the bytes
  rather than block on the write.
- **Scope creep into fixing the pre-roll.** Signal: an edit to `PRE_ROLL_MS`
  appears in the diff. Response: this phase diagnoses only; the constant is an
  explicit non-goal of this plan because it has a latency price.
