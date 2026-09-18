# Phase 1 — Timestamp points at the turn's own audio

Status: done in every file this phase writes; the stored row does not move until
the reducer patch handed to the speaker-floor agent is applied (see below)

## Context

`PRE_ROLL_MS = 320` (`capture-pump.ts:22`) prepends 320ms of audio to every turn
so the first syllable survives. It corrects the audio and not the timestamp, so a
row's `offsetMs` points 320ms after the first sample that row's own audio
contains. Measured bias against true speech onset is +217ms on conversation 1 and
+317ms on conversation 2; the system-attributable part is +196ms and replicates
to within 3ms. Full decomposition in `../reports/timeline-260918-1448-offset-bias.md`.

## Requirements

Carry the pre-roll actually applied on the capture record and subtract it inside
`displayGroupOffsetMs`, derived from the blocks handed to `openTurn` rather than
from the constant — `closeTurn` clears the pre-roll and `capture-pump.ts:150`
documents a turn opening with an empty one.

Do NOT subtract at the `openedAt` stamp. `display-groups.ts:95` merges on
`openedAt − closedAt` against a 1200ms cap and refuses to merge on a negative gap
(`:96`); moving every open 320ms earlier over-merges turns 1.4s apart and refuses
merges that should happen after a forced cut. It would also move the stall
watchdog (`turn-pipeline.ts:459`) and the turn-length metrics.

## Files

`packages/realtime-client/src/audio/capture-pump.ts`,
`src/conversation/turn-pipeline.ts`, `src/state/conversation-turns.ts`, and their
specs; fixture-only edits in `apps/web/src/hooks/use-conversation-save.spec.tsx`
and `apps/api/src/modules/conversations/conversations.service.spec.ts`.

## Validation

`transcript-time-parity.spec.tsx` must pass untouched — if it fails, the
correction went on one side only, which is what it exists to catch. Re-measure
against both recordings; expect conversation 1 ~103ms early and conversation 2
roughly on the onset, both on the recoverable side of the rule at
`transcript-time.ts:26`.

## Risk

`displayGroupOffsetMs` clamps at 0 and the write schema is `min(0)`
(`packages/types/src/domain/conversation.ts:68`); only the clamp prevents a 400
that loses the whole save. Early turns must not all collapse onto `0:00`.

## Implementation note

`preRollMs` is measured in `openTurn` from the blocks the pump hands over —
`sum(block.length) / TARGET_SAMPLE_RATE` — so a turn that opened with an empty
pre-roll records 0 and is not shifted at all. It rides on `CapturedTurnMetrics`
beside the UNCHANGED `openedAt`, and `displayGroupOffsetMs` subtracts it before
the existing clamp. Grouping, the stall watchdog and the metrics rows still read
`openedAt`, which is what option A would have moved.

The field is OPTIONAL on the capture record. That was not in the brief and it
matters: a capture without one behaves exactly as before, so no existing fixture
had to move, and the two fixture-only edits the phase allotted
(`use-conversation-save.spec.tsx`, `conversations.service.spec.ts`) turned out
not to be needed. The extension and mobile share this export and have their own
dispatch sites; they keep today's behaviour until they send the field.

### The phase's file list was three short

The capture record `displayGroupOffsetMs` reads is `TurnCapture`
(`state/turn-keyed-transcript.ts`), and the chain from the pipeline to it runs
`CapturedTurnMetrics` -> `conversation-session.ts` `onTurnCaptured` ->
`apps/web/src/hooks/use-streaming-translate.ts` dispatch -> the reducer's
`transcript.turnCaptureRecorded` case. None of the three were in this phase's
file list. Two were granted and are done: `conversation-session.ts` carries the
field on the `onTurnCaptured` capture type and forwards it, and the web hook
threads it into the dispatch.

The reducer is the one part NOT applied here. `turn-keyed-transcript.ts` is being
rewritten concurrently by the speaker-floor work, so the patch — `preRollMs?:
number` on `TurnCapture`, the same on the action, and `preRollMs:
event.preRollMs` in the case — was handed to that agent to apply inside its own
pass rather than written by a second author. Until it lands, every capture
reaching the reducer still arrives without a pre-roll and
`packages/realtime-client` carries one typecheck error naming exactly that gap
(`conversation-turns.ts(183,48)`).

### Re-measured

Conversation 1, `scratchpad/conv/rec.wav` by the method in `final.py`, with the
per-turn pre-roll simulated the way the pump fills it rather than a flat 320:

|        | median    | p10    | p90    |
| ------ | --------- | ------ | ------ |
| before | +217.0    | +180.0 | +695.0 |
| after  | **-79.0** | -140.0 | +375.0 |

Early, which is the recoverable side (`transcript-time.ts:26`). No row clamps to
0 and all 53 corrected offsets stay distinct, so the risk above did not
materialise. It lands at -79 rather than the predicted -103 because 22 of the 65
simulated turns opened holding less than a full pre-roll — the correction is
bounded by what each turn actually recorded, which is the point of deriving it
from the blocks.

**That 22-of-65 is the measurement that justifies forbidding the constant.** A
flat `PRE_ROLL_MS` would have over-corrected every one of those turns by the
difference between 320ms and what they actually held, and nothing in the suite
would have failed: the residual would simply have been wrong, on a third of the
conversation, in a direction no assertion looks at.

### Verified

`packages/realtime-client` green (371 tests at the last run, the count moving as
other phases land beside it). On the web side `transcript-time-parity`,
`use-streaming-translate`, `use-conversation-save` and `cascade-panel` all pass.

**Those web runs only mean something with `@chatofy/realtime-client` aliased to
source.** The package's `exports` point at `dist/`, so a plain `vitest` run in
`apps/web` grades the last build rather than the working tree — green there would
have said nothing about this change. Anyone re-running the chain either aliases
the package to `src/index.ts` or rebuilds it first.

`transcript-time-parity.spec.tsx` gained ONE case and every existing case is
byte-identical, so the file still proves what it proved before and now also
proves that both screens apply the same correction to the same capture. Without
it the gate agreed about nothing: none of its fixtures carried a pre-roll, so it
passed whether or not the subtraction happened at all.

The added case opens its turn at 6_500ms deliberately. `formatOffset` floors to
seconds, so the correction has to cross a whole second to be visible in a string
— 5.1s uncorrected against 4.78s corrected, `0:05` against `0:04`. A realistic
320ms pre-roll on a turn that opened mid-second would render the same string
either way and assert nothing. It was verified to bite: with the subtraction
removed the case fails with `expected [ '0:05' ] to deeply equal [ '0:04' ]`, and
the case also asserts the same instant with no pre-roll still reads `0:05` on
both screens, so the move is the correction rather than a fixture chosen to land
there.

### The reducer patch, verbatim

Handed to the speaker-floor agent rather than written here. Three additive hunks
in `packages/realtime-client/src/state/turn-keyed-transcript.ts`: `preRollMs?:
number` after `closedAt` on `TurnCapture`, the same on the
`TurnCaptureRecorded` action, and `preRollMs: event.preRollMs,` in the object the
`transcript.turnCaptureRecorded` case writes. It is applied when
`tsc -p packages/realtime-client/tsconfig.json --noEmit` stops reporting
`conversation-turns.ts(183,48)`.

Three complaints are expected until then, and all three are the same missing
field seen from different layers: that error; `preRollMs` rejected as an excess
property on the dispatched action in an `apps/web` typecheck; and an
`@typescript-eslint/no-unsafe-assignment` warning on the `preRollMs` line of that
dispatch, which is the field reading as error-typed because `apps/web` resolves
the package through `dist/`. The web side therefore needs the package rebuilt as
well as the patch applied.
