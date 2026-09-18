# Phase 3 — The lost tail

## Context

Diagnosed: `plans/reports/tail-diagnosis-260918-1356-conversation-tail-turn-loss.md`.

When a turn exhausts its `too_many_turns` retries, `TurnPipeline` invents the
close reason `'too_many_turns'` itself and forgets the turn. `isServerReason()`
(`packages/realtime-client/src/conversation/conversation-session.ts:951`) excludes
exactly three invented reasons — `never_started`, `dropped_pending`, `stopped` —
and this is a fourth. Read as server-originated, it never reaches `abandonTurn()`,
and `reportTurnCapture` is a no-op because no `sessionId` was ever assigned. The
turn leaves no live line, no abandoned marker, no metrics row and no
`ConversationTurn`, while the recorder keeps its audio.

The wall-clock evidence agrees: `endedAt` lands 10 ms after the recording's own
clock stops, which rules out the 20 s drain backstop (that path reports
`'stopped'`, which IS excluded, so it would have left a mark).

What is NOT proven is what caused the refusals. The API keeps sessions in memory
and the container has since restarted, so the logs from 2026-09-16 are gone. The
loss mechanism stands on its own regardless: any exhaustion silently drops a turn.

## Requirements

- A turn that dies leaves a trace the transcript can show.
- No change to the reasons that genuinely come from the server.

## Files

- `packages/realtime-client/src/conversation/conversation-session.ts` — `isServerReason`
- `packages/realtime-client/src/conversation/conversation-session.spec.ts`

## Steps

1. Add `'too_many_turns'` to the exclusion list, beside `'dropped_pending'`:
   both are cases the pipeline invented with no server session behind them.
2. Extend the function's doc comment — it already explains the rule, and the
   fourth reason should not read as an afterthought.
3. Regression test: drive the pipeline's refusal-exhaustion path and assert
   `onTurnAbandoned` fires. `conversation-session.spec.ts` has no coverage of
   `isServerReason` at all today.

## Validation

`pnpm --filter @chatofy/realtime-client test`

## Risk and rollback

`abandonTurn` marks the turn in the transcript; it does not recover the words,
which were never sent. Rollback is removing the reason from the list.

## Sequencing

Touches the same file as phase 2, so it lands after that edit rather than beside it.

## What was done

`'too_many_turns'` added to the exclusion list, with the doc comment rewritten to
say why it reads wrong at a glance — the server really does send the refusal, so
the code looks server-originated; what the pipeline invents is the decision to
stop retrying it.

The regression test drives the real path rather than the function: it opens a
turn, emits five `server.error` refusals with the retry timer advanced between
them, and asserts `onTurnAbandoned(null, 'too_many_turns')`. The `null` is part of
the point — this turn never reached a server session, which is exactly why the
close had to be reported from the client. Confirmed to fail against the unfixed
`isServerReason` and pass after it.

`FakeTranslateSocket.startSession` now records the turn id its CALLER chose,
which is the real socket's contract; it used to mint its own and discard the
pipeline's, so no test could address a turn the server had refused.

## The second half: not giving up while still holding the audio

Reporting the loss is not the same as not losing it, so the retry budget was
fixed too. Two deadlines disagreed: `MAX_PENDING_MS` kept a waiting turn's audio
for 20 seconds, while `MAX_REFUSAL_RETRIES` (4 attempts at 750 ms) stopped trying
to send it after about 3. For the other 17 seconds the pipeline held audio it had
already given up on.

`MAX_REFUSAL_RETRIES` is gone. A refused turn is now given up on when
`now() - turn.openedAt >= MAX_PENDING_MS` — one deadline, read from the constant
that already governs how long the audio is worth keeping, so the two cannot drift
apart again.

Checked before accepting it: a 20-second budget gives the pending ceiling time to
bite mid-retry, which would be a problem if it could empty a waiting turn and
leave it retrying with nothing to send. It cannot — `enforcePendingCeiling`
forgets a `waiting` turn whole, with reason `'dropped_pending'`, which is already
in `isServerReason`'s exclusion list and so is already reported. Only a turn past
`waiting` has its buffer emptied while the turn lives on.

## Still open

Why the refusals happened at all. The API keeps sessions in memory and the
container has restarted since, so there is no log from that night to read. The
loss mechanism does not depend on the answer — any exhaustion dropped a turn
silently — but the trigger is unexplained, and the give-up site logs only to the
browser console. A durable counter there is what would answer it next time.
