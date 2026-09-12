---
phase: 2
title: 'Phase 2: Make discarded audio countable and dropped turns visible'
status: completed
priority: P1
effort: '4-6h'
dependencies: [1]
---

# Phase 2: Make discarded audio countable and dropped turns visible

## Overview

Today the client can throw away captured audio with no log, no counter, and nothing on
screen — and worse, it reports that audio as _sent_. `translate-socket.ts` `send()` returns
early when the socket is not OPEN, while `turn-pipeline.ts` has already advanced `sentMs`
and `sequence`. Every number derived from `capturedMs` is therefore optimistic by exactly
the amount that was lost, which makes "did the fix work" unanswerable.

This phase is what turns the user's report ("mất nội dung rất nặng") from an anecdote into
a measurement. It ships with Phase 1: Phase 1 removes the stall, Phase 2 proves whether
loss stopped.

## Requirements

Functional:

- `sentMs` and `sequence` advance only when a frame actually left the socket; otherwise the
  block is held, like the already-correct not-yet-streaming path.
- The `pushAudio`-with-no-capturing-turn path increments a counter instead of returning silently.
- A turn dropped at the pending ceiling renders the existing "unheard" marker.

Non-functional:

- No UI change. The marker already exists and is already rendered for `backlog` and
  `stalled`; this only makes a third reason reach it. The accent-budget specs must stay
  untouched and green.
- `capturedMs` semantics change (it becomes honest). Existing spec expectations that
  encode the optimistic behaviour must be updated deliberately, not deleted.

## Architecture

Three separate loss paths, one theme: the client already has the right machinery and simply
does not route these cases into it.

1. **`translate-socket.ts:135`** — `send()` is `void` and swallows a closed socket. Making it
   return a boolean lets the caller distinguish "sent" from "dropped" without changing the
   wire contract.
2. **`turn-pipeline.ts:253-266`** — `pushAudio` increments `turn.sentMs` _before_ calling
   `transport.sendAudio`, and `turn.sequence++` is an argument to that call. Both advance
   even when nothing goes out. The fix is to send first, then advance on success, and
   otherwise fall through to the existing `hold(turn, block)` — which is already the correct
   behaviour for the not-yet-streaming case, so this is reusing a local pattern rather than
   inventing one.
3. **`turn-keyed-transcript.ts:189-193`** — `UnheardReason` is `'backlog' | 'stalled'` and
   `turn-pipeline.ts:554` already calls `forget(oldest, 'dropped_pending')`. The reason is
   discarded purely because the set does not list it. The type's own docstring states the
   intent: "adding a third reason upstream is a type error here instead of a marker that
   quietly stops appearing" — so adding it is the documented extension path, not a new design.

## Related Code Files

- Modify: `packages/realtime-client/src/transport/translate-socket.ts` — `send()` returns `boolean`; `sendAudio` propagates it
- Modify: `packages/realtime-client/src/conversation/turn-pipeline.ts` — `pushAudio` advances counters only on a successful send; the orphaned-block early return increments a counter
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` — add `'dropped_pending'` to `UnheardReason` and `UNHEARD_REASONS`
- Modify: `packages/realtime-client/src/conversation/turn-pipeline.spec.ts` — cover both send paths
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts` — cover the new reason
- Check: `packages/realtime-client/src/conversation/conversation-session.spec.ts` — may assert the old optimistic `capturedMs`

## Implementation Steps

1. Change `send()` to return whether the frame was written, and have `sendAudio` pass that
   result back. Keep the early-return behaviour itself — silence on a closed socket is
   correct; only the reporting was wrong.
2. In `pushAudio`, reorder so the send happens first and `sentMs` / `sequence` advance only
   on success. On failure, route the block into the existing `hold(turn, block)` plus
   `enforcePendingCeiling()` path. Confirm `sequence` is not consumed by the failed attempt,
   or the server's `sequence > lastSequence` check will reject the next frame as out of order.
3. Add a counter for the orphaned-block path (`capturing === null`) and make sure it reaches
   the same metrics row as `heldMs` and `discardedMs`.
4. Add `'dropped_pending'` to the `UnheardReason` union and the `UNHEARD_REASONS` set. Let
   the type error guide any exhaustive switch that now needs the third case.
5. Update the specs that encoded the optimistic `capturedMs`, stating in the commit body that
   the metric changed meaning rather than that a test was "fixed".
6. Run `pnpm --filter @chatofy/realtime-client test`, then lint, typecheck, and the web
   design specs to confirm no UI drift.

## Success Criteria

- [x] A non-OPEN socket leaves `sentMs` and `sequence` unchanged and holds the block
- [x] The held block is sent, in order, once the socket opens — nothing is lost and nothing is duplicated. Review hardening on top: the streaming path refuses to jump the queue when held frames remain (`pushAudio` holds the new block too), and `flushPending` stops at the first refused frame, re-holding the remainder — so in-order delivery is guaranteed at the interface level, not just for the current socket
- [x] The orphaned-block path increments a counter — amended in implementation: it surfaces through a getter (`orphanedAudioMs`) and an `onLog` diagnostic rather than the metrics row, because a row is per-turn and orphaned audio's turn is by definition gone. Same visibility channel as every other input-loss path (the web hook logs it); the row itself cannot carry turn-less audio.
- [x] A turn forgotten as `dropped_pending` renders the unheard marker
- [x] `pnpm --filter @chatofy/realtime-client test` green
- [x] `apps/web/src/design/accent-budget-app.spec.tsx` untouched and green

## Risk Assessment

**The sequence-number hazard is the real risk here.** The server rejects a frame whose
sequence is not strictly greater than the last (`turn-session.ts:196-201`, answering
`frame_rejected`). If a failed send consumes a sequence number, the next successful frame
lands with a gap and the server refuses it — converting a silent loss into a visible
rejection storm. Step 2 must confirm the increment happens only on success. Signal it broke:
`frame_rejected` errors appearing in api logs right after this ships. Pre-decided response:
revert this step, keep the `dropped_pending` marker (which is independent).

**`capturedMs` becoming honest will look like a regression.** Any dashboard or analysis
comparing before/after will show capture dropping, because the old number counted audio
that never left the browser. This must be stated wherever the metric is reported, or a later
reader will hunt for a fault that was never there — the same trap
`benchmarks/realtime/README.md` already warns about for its own numerator.

**Unbounded holding.** Holding instead of dropping shifts memory into `turn.pending`, and
`enforcePendingCeiling` deliberately excludes the currently-capturing turn, so that buffer is
bounded only by `maxUtteranceMs` (~8.3s of PCM16, a few hundred KB). Acceptable, and
explicitly out of scope to change — the exclusion is a deliberate "never drop the words being
spoken" decision.
