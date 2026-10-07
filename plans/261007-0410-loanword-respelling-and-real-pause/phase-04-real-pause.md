---
phase: 4
title: 'Real pause: clock, recorder, offsets, paused time'
status: completed
priority: P1
effort: '8h'
dependencies: []
---

# Phase 4: Real pause

## Goal

Pausing a conversation freezes the elapsed clock and pauses the recording. Transcript offsets are measured in active time, so they still seek correctly. The saved conversation carries `pausedMs`, so the History duration is active time.

## Design

- **Offsets in active time.** Measure every offset as active time (wall time minus the paused time before it).
  - The recorder pauses over exactly the same intervals, so media time equals active time minus `audioOffsetMs`.
  - The existing `mediaOffset()` (`apps/web/src/lib/transcript-time.ts:66`) then stays correct without storing intervals.
  - The only new stored value is the total `pausedMs`, used for the duration.
- **Owner.** `ConversationSession` (realtime-client) owns the pause intervals (`pausedSince`, accumulated `pausedMs`), because it owns `pause()`/`resume()`/`finish()`. It exposes `activeElapsedMs(now)` and `pausedBefore(t)`.
- **Recorder.** The web recording hook calls `recorder.pause()`/`resume()` on the same transitions.
- **Pause at End.** `finish()` while paused closes the open interval at that instant, so `pausedMs` includes it.

## Files

- Modify:
  - `packages/realtime-client/src/conversation/conversation-session.ts`: record the intervals in `pause()`/`resume()`/`finish()`/`stop()`, and expose them. Rewrite the docblocks that say pause releases nothing and keeps recording.
  - `packages/realtime-client/src/state/conversation-turns.ts`: `displayGroupOffsetMs` subtracts the paused time before `spokenAt`, using the intervals passed in alongside `startedAtMs`.
  - `apps/web/src/hooks/use-streaming-translate.ts`: expose `pausedMs`/the intervals and forward the pause transitions to the recorder.
  - `apps/web/src/hooks/use-conversation-recording.ts`: add `pause()`/`resume()` that call `MediaRecorder.pause/resume` when the state allows it. Replace the "Why it records straight through pause" section with the new invariant.
  - `apps/web/src/components/translate/elapsed-clock.tsx` and `cascade-panel.tsx:473`: the clock takes a `pausedMs` plus a `pausedSince` and freezes while paused. Rewrite the "It counts the conversation, not the talking" docblock.
  - `apps/web/src/hooks/use-conversation-save.ts` and `apps/web/src/clients/api-client.ts`: send `pausedMs`.
  - `packages/types/src/http/conversations.ts`: add `pausedMs` to `saveConversationRequestShape`, as an int ≥ 0 that defaults to 0, and to the response/summary types.
  - `apps/api/prisma/schema.prisma`: add `Conversation.pausedMs Int @default(0)` with a migration. Back up the database first: `pg_dump` of prod before deploy, and of the dev DB before `migrate dev`.
  - `apps/api` conversations store/service: persist and return `pausedMs`. An update keeps the larger of the stored and incoming values, the same way `endedAt` is stamped once.
  - `apps/web/src/components/history/conversation-formatting.ts:121` and `conversation-detail.tsx:86`: duration = `endedAt − startedAt − pausedMs`, floored at 0.
  - `packages/i18n/src/en.ts:562-579` and the other locale files: replace the copy that says the microphone keeps recording while paused with the new behaviour.
- Tests:
  - `conversation-session` spec: covers the intervals across pause/resume/finish-while-paused.
  - `transcript-time-parity.spec.tsx`: a session paused once has an offset after the pause that equals media time.
  - `use-conversation-recording.spec.tsx`: the recorder is paused and resumed.
  - The elapsed clock spec freezes while paused.
  - API conversations spec: covers the `pausedMs` round trip and the default 0 for old rows.
  - `apps/web/src/design/accent-budget-app.spec.tsx` must stay green, because the screen states are unchanged.

## Steps

1. **Session intervals.** Add the interval bookkeeping to `ConversationSession` and test it.
2. **Offsets.** Change the offset computation and the parity spec together.
3. **Recorder.** Add the pause/resume wiring, and handle `MediaRecorder` in the `inactive` state (no-op).
4. **Clock.** Make the clock freeze.
5. **Contract.** Change the types, Prisma and the API, then the web save. The order matters: the API accepts the field before the web sends it.
6. **Copy.** Update the History duration and the i18n copy.
7. **Manual check on dev.** Start a conversation, pause for 5 s mid-sentence, then resume. Confirm that:
   - the clock froze;
   - the recording has no paused stretch;
   - clicking a turn after the pause seeks to its words;
   - the History duration is about the wall time minus 5 s.

## Verification

- `pnpm --filter @chatofy/realtime-client test`
- `pnpm --filter @chatofy/web test`
- `pnpm --filter @chatofy/api test conversations`
- `pnpm -w typecheck && pnpm -w lint && pnpm -w build`
- The manual dev check above, run by the implementer, not handed to the user.

## Risks

- **Browser `MediaRecorder.pause` support.** Chromium and Firefox support it. Guard with `typeof recorder.pause === 'function'`. Where it is missing, the recording runs straight through, so offsets must keep the old wall-time meaning (paused time counted as zero) or seeks would land early; say so in a comment.
- **Old rows have `pausedMs` 0,** which equals their old meaning. No backfill is needed.

## Outcome (2026-10-07)

- **Built in a worktree and applied here.** Report: `plans/reports/fullstack-developer-261007-1120-real-pause-implementation.md`.
- **New code.**
  - `pause-intervals.ts` (`pausedMsBefore`) is the one rule for both offsets and duration.
  - Migration `20261007043556_conversation_paused_time`: additive, default 0.
  - `activeDurationMs` in History.
  - en/vi copy updated.
- **Deviations.**
  - No `activeElapsedMs` on the session, because the session never sees `startedAt`.
  - The clock takes the pause list, so it never steps back after Resume.
- **Review** (`plans/reports/code-reviewer-261007-1210-real-pause-review.md`):
  - H1: a lint autofix dropped an `as Route` cast. Restored, and `pnpm --filter web build` passes.
  - M1: each interval is now floored at 0, and the saved total is capped at the span, with 2 tests.
  - M2: measured. Chromium gave 3960 ms of media and Gecko 3861 ms, for ~7010 ms wall with a 3 s pause. WebKit is not measured, because it cannot launch on this host without system libraries.
  - L1: commented.
  - L2 and L4: comments fixed.
  - L3 (End while paused leaves the drain unrecorded): left as is. It is noted as an open question.
- **Not run.** The full manual dev check with History, because no dev web plus speech stack ran.
