---
phase: 1
title: 'Phase 1: Speaker roster and identity state'
status: completed
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Speaker roster and identity state

## Overview

The roster (who is in this conversation) and the rule that assigns a speaker to a turn, as testable
state in `packages/realtime-client`. No UI, no network, no model.

## Requirements

**Functional**

- [x] A roster of session speakers, each with an id and a display label
- [x] Add a speaker, rename one, remove one
- [x] Assign a speaker to a finished turn, and change that assignment afterwards
- [x] A turn nobody assigned carries an explicit fallback, distinguishable from an assignment
- [x] The roster and every assignment vanish when the session ends

**Non-functional**

- [x] Pure state, driven by the existing reducer — no React, no transport, testable headless
- [x] Anonymous labels by default; naming is optional and session-only

## Architecture

**This lives in `packages/realtime-client`, not in `apps/web`.** The package comment on
`turn-keyed-transcript.ts` states the reason directly: the rule that matters is about ordering,
ordering bugs are invisible in a component, and this project has shipped that defect twice in
untested client code. Speaker assignment has the same property — a label attached to the wrong turn
looks like nothing at all.

**Reuse the reducer; do not add a second state container.** `turnKeyedTranscriptReducer` already
mixes client-only actions (`transcript.reset`, `transcript.turnAbandoned`, `transcript.liveDelta`)
with server events, so client-only speaker actions follow an established pattern rather than
inventing one. Adding a parallel store would put two sources of truth on one screen.

**Identity shape.** A session speaker is `{ id, label }`. A turn's attribution is
`{ speakerId, origin }` where `origin` is one of:

- `confirmed` — a person said so. Only this origin is allowed to seed a centroid in Phase 5.
- `suggested` — the acoustic layer proposed it. Phase 5 introduces this; Phase 1 defines it so the
  distinction is in the type from the start rather than retrofitted onto a boolean later.
- `fallback` — nobody assigned it and nothing suggested one.

The three-way `origin` is the mechanism that keeps the design's two load-bearing rules enforceable.
A boolean `isConfirmed` cannot express "nobody attributed this", which is the state that must never
render as an identity.

**Anonymous by default.** Labels start as "Người nói 1", "Người nói 2". Naming is opt-in, because
a stored name bound to a stored voiceprint is exactly what the no-persistence constraint exists to
prevent — and even in memory, the pairing is worth not creating by default.

**Attributions are keyed by the server's `sessionId`.** Three identifiers could plausibly be
called "the turn id" here and they are not interchangeable: the client's `turnId`, the server's
`sessionId`, and the segment's own `id`. The reducer already keys its live turns by `sessionId`,
with the stated reason that every event carrying live text carries that and only that. Attribution
uses the same key so one turn has one address across the whole reducer.

**Speaker cap.** 8, carried from the prior contract. A roster longer than that is not a conversation
around one microphone.

## Related Code Files

- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` — roster + attribution in the reducer
- Create: `packages/realtime-client/src/state/speaker-roster.ts` — roster rules, if the reducer file passes ~200 lines
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts` — existing assertions must keep passing unchanged
- Create: `packages/realtime-client/src/state/speaker-roster.spec.ts`
- Modify: `packages/realtime-client/src/index.ts` — export the new types
- Read (do not modify): `packages/types/src/domain/session.ts`, `apps/api/src/modules/translate/session/turn-session.ts`

## Implementation Steps

1. Define the speaker and attribution types. Keep `origin` a three-value union from the start.
2. Extend the reducer state with a roster and a `sessionId`-keyed attribution map. Leave existing
   state shape and every existing action untouched.

   The roster lives in the reducer, not above it. Its lifetime is the conversation's: a
   `CascadePanel` remount already releases the microphone, closes the socket and destroys the
   transcript, so a roster that outlived it would be labels with nothing left to label. `direction`
   is deliberately held higher, but it is different in kind — it configures the _next_ session,
   while the roster describes _this_ one.

3. Add actions: add speaker, rename, remove, assign turn.
4. Decide removal semantics explicitly: removing a speaker who already has turns must not orphan
   them into a dangling id. Either re-point those turns to `fallback` or refuse the removal — pick
   one, write the test that names it, and say which in the code comment.
5. Export from the package index.
6. Write the spec. Cover: assignment survives later turns arriving; re-assignment overwrites rather
   than duplicating; a reset clears roster and attributions together; the cap refuses a 9th speaker.

## Success Criteria

- [x] Roster and attribution are reachable from the reducer with no React involved
- [x] Every pre-existing assertion in `turn-keyed-transcript.spec.ts` passes without being edited
- [x] Removing a speaker with turns has a defined, tested outcome — no dangling ids
- [x] `transcript.reset` clears roster and attributions
- [x] The 9th speaker is refused
- [x] `pnpm --filter @chatofy/realtime-client test` and `typecheck` pass

## Risk Assessment

- **The reducer outgrows its file.** `turn-keyed-transcript.ts` is a coherent unit today. Signal:
  it passes ~200 lines, or the speaker rules start needing their own vocabulary. Response: extract
  `speaker-roster.ts` and have the reducer delegate. Do not split before the signal — a two-file
  design for one small map is the DRY/KISS violation, not the fix.
- **Re-assignment races a late server event.** A person corrects turn N while turn N+2's final
  arrives. Signal: an attribution lands on the wrong turn in the spec that interleaves them.
  Response: key attributions by `sessionId`, never by array position. Write that interleaving test
  first — it is the exact defect class the package comment says has shipped twice.
- **`origin` looks like premature generality in this phase.** It has one consumer until Phase 5.
  Signal: a reviewer asks to reduce it to a boolean. Response: refuse and point here. The two rules
  the whole design rests on are unenforceable without a third state, and retrofitting one onto a
  shipped boolean means touching every call site.
