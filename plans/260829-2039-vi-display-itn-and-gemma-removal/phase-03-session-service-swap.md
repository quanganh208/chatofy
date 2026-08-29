---
phase: 3
title: 'Session-service swap'
status: complete
priority: P1
effort: '0.5d'
dependencies: [2]
---

## Result — 2026-08-29

One file changed as planned, plus the two additive contract edits D10 requires.

| criterion                                               | result                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A6 — one display per turn, same tick, only when changed | `transcript.final` count 1, `transcript.display` count 0                     |
| A15 — a throwing ITN cannot fail the turn               | transcript emitted, audio frames delivered, `completed: true`                |
| A14 — direction SELECTS the module                      | `en_to_vi` -> `en`, `vi_to_en` -> `vi`; English keeps `2,500`, never `2.500` |
| A5 — persisted record stays raw                         | `segment.sourceText` unchanged, differs from `display`                       |
| a numeral-free turn                                     | **zero** display values, field absent from the event                         |
| a client without `repairDisplay`                        | no display, and the ITN is not even called                                   |
| an empty turn                                           | no display                                                                   |
| `apps/web/**` diff                                      | **empty** — the reducer change is confined to `packages/realtime-client`     |
| typecheck + translate suite                             | 16/16 tasks, 571/571 tests                                                   |

**A defect the new spec found, which the old tripwire could not have.** A blank
ITN result would have set `display: ''`, and the client falls back with
`display ?? sourceText` — `??` does not catch an empty string, so the turn's
words would have been erased on screen. Guarded in `displayFor`, and the
invariant "a display value is never empty" now holds for every reader of the
field. This is exactly the class of bug this phase's risk section predicted the
web-test tripwire would miss, since web specs pass `repaired` as a prop and never
exercise the emit path.

### What changed

- `repairForDisplay` (fire-and-forget, 65 lines) -> `displayFor` (synchronous,
  returns a value). Returning rather than emitting is what keeps the rendering on
  the same event as the transcript.
- The ITN runs **before** `:335`, so its result rides on `transcript.final`.
  A throw would now precede the transcript emit entirely, which is why the
  `try/catch` matters more than it did, not less — the old draft's "the ITN is
  total, no catch needed" was an assertion about code that did not exist yet.
- Deleted at this call site: `repairsInFlight`, the
  `MAX_CONCURRENT_DISPLAY_REPAIRS` import and gate, and the `recordRepair` call
  (which strands `turn-metrics.recorder.ts`, swept in Phase 4).
- Kept: the `session.repairDisplay` opt-in and the empty-text gate.
- `ws-events.ts`: `server.transcript.final` gains optional `display`;
  `server.transcript.display` marked dead surface but still declared.
- `turn-keyed-transcript.ts`: `displays` populated from the final event, in the
  same update that appends the turn. The legacy event case is KEPT and labelled —
  this client may be talking to a server that has not been deployed yet, and
  dropping it would lose a display rather than delay one.

### Deviation

Both repair specs were replaced by one `translation-session-display.spec.ts`
(13 tests) rather than rewritten in place; `pipeline-display-repair.spec.ts` was
deleted outright, since `repairDisplay()` itself dies in Phase 4.

# Phase 3: Session-service swap

## Overview

One file changes: `apps/api/src/modules/translate/services/translation-session.service.ts`.
The fire-and-forget repair launch becomes a synchronous ITN call emitting
`server.transcript.display` in the same handler tick as `server.transcript.final`.

**Swap-in and rip-out at this call site are inseparable** — they are the same
function. Splitting them would leave two producers of `server.transcript.display`
and violate A6.

## Requirements

- Functional: **at most** one display value per turn, emitted synchronously, and
  **only when the ITN actually changed the text**.
- Non-functional: the WebSocket contract does not change. No schema edit, so tabs
  left open across the deploy never see "Unexpected event shape".

## Four gates, not two — three that survive and one that is new

**Red-team found the original three-gate list was both wrong and short.**

## The gates that must survive

`repairForDisplay` is not only a launcher — it carries guards the ITN still needs.
Verified at `:424-432`:

```ts
if (!session.repairDisplay) return;        // client opt-in — KEEP
if (!sourceText.trim()) return;            // empty turn — KEEP
if (this.repairsInFlight >= MAX_...) ...   // concurrency ceiling — DELETE
```

**Keep the `session.repairDisplay` flag gate.** The flag's name becomes a misnomer
once no repair exists, but it is the client's opt-in and renaming it is a breaking
contract change this plan deliberately does not take. A client that did not ask for
display must still not receive it.

**Keep the empty-text gate**, for a better reason than before: the old comment says
"a repair could only invent some". The ITN cannot invent anything, but emitting a
display event for a wordless turn is still noise.

**Delete the concurrency ceiling.** A pure function has nothing in flight.

**ADD a direction SELECTOR (D9), not a gate.** `repairForDisplay` reads `session.direction` (`:445`) and
passes it down: `pipeline-translator.service.ts:263` resolves it via
`directionLanguages()`, and the repair prompt is genuinely language-parametric
(`transcript-repair-prompt.ts:40-43` interpolates the language name into every
rule). Under D9 both directions get an ITN, so `direction` selects **which** module runs
rather than whether one runs at all. `ws-events.ts:142-143`'s documented contract —
_"Applies to whichever language is being SPOKEN, not to Vietnamese: on `en_to_vi`
the thing repaired is the English transcript"_ — therefore stays true and needs no
edit. An earlier draft would have let English display silently stop while listing
`en_to_vi` as a non-goal; red-team caught that, and D9 reversed it.

**ADD the ITN's own `try/catch`.** See the risk section — this is not optional.

## Wiring points (verified 2026-08-29)

| line       | today                                                           | after                                                                     |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `:335`     | emits `server.transcript.final`                                 | unchanged — natural ordering already correct                              |
| `:335`     | emits `server.transcript.final`                                 | **now carries the optional `display` field** (D10)                        |
| `:348`     | `this.repairForDisplay(socket, session, translated.sourceText)` | deleted — the ITN runs BEFORE `:335` and its result rides the final event |
| `:421-485` | `repairForDisplay`                                              | deleted                                                                   |
| `:463`     | `this.metrics.recordRepair({...})`                              | deleted — **strands `turn-metrics.recorder.ts`, cleaned in Phase 4**      |
| `:78`      | `private repairsInFlight = 0`                                   | deleted                                                                   |
| `:32`      | imports `MAX_CONCURRENT_DISPLAY_REPAIRS`                        | deleted                                                                   |

**The ITN call MUST be wrapped in its own `try/catch` that logs and falls through
to raw.** The earlier draft of this phase asserted "there is no failure branch, the
ITN is total on a string" — an assertion about code Phase 2 has not written yet,
used to justify removing the only isolation the call site has. That reasoning is
exactly what the existing code refuses: today's `.catch()` at `:472-482` carries
the comment _"`repairDisplay` documents that it never throws, and this does not
trust it."_

The blast radius if it throws unguarded: the call sits inside the `try` opened at
`:306`, whose `catch` at `:396-402` runs `record(false, 'error')`,
`reportTurnFailure(...)` and `close(socket, session, 'error')`. Since it fires
**after** `server.transcript.final` went out but **before** clause streaming, the
listener gets a finished transcript, an error, and **no audio**. A cosmetic display
feature would have become able to silence the product, reproducibly, on every turn
containing the triggering token.

What remains true: no timeout, no quota, no 429, no rejection state, no orphaned
120-second socket.

## D10 — the display rides on `transcript.final`, not a second event

Two `channelFor().emit()` calls are two `send`s (`session/event-channel.ts:56-58`),
two WS frames, two `message` events, two macrotasks;
`use-streaming-translate.ts:261` dispatches per event with no coalescing. React
batches within a task, not across tasks — so a same-tick _server_ emit still gave a
one-frame flash of the words-form. Goal 1 says the line never visibly changes, so
one event is the only structural answer.

`server.transcript.final` gains an **optional** `display?: string`. Old clients
ignore an unknown optional field, so this is additive and no tab breaks across the
deploy. The reducer populates `displays[sessionId]` from the final event instead of
from a separate one — everything downstream (`groupIsRepaired`,
`TranscriptSourceLine`) is unchanged.

`server.transcript.display` stays **declared in the schema** — an old client build
still handles it — but the server stops emitting it. Record it as dead surface with
a follow-up; removing it is a breaking change this plan does not take.

**Order inside the handler:** run the ITN, then emit `final` carrying the result.
The ITN must therefore run BEFORE `:335`, not after it — which also means a throw
would now precede the transcript emit entirely, making the `try/catch` below more
important, not less.

## Set `display` only when the text actually changed

Today `display` is emitted **only when `repair.text !== null`** (`:456`) — only for
turns the model rewrote and the guard passed. The client treats _presence of an
entry in `displays`_ as the signal "this line differs from the recognizer's
output": `display-groups.ts:196-197` is `some(turn => displays[turn.sessionId]
!== undefined)`, and `transcript-source-line.tsx:44` takes an
`if (!repaired) return <p>` early exit on the strength of it.

Emitting for every non-empty turn would put a chevron and a "show original"
disclosure under **every line in the conversation**, where the disclosed original is
character-for-character the text above it. The component's own comment
(`transcript-source-line.tsx:27-31`) names this as the thing it was built to avoid:
_"Showing a disclosure on every turn would teach people to ignore it on the turns
where it matters."_

Most turns contain no numerals at all, so most ITN outputs are byte-identical to
raw. **Omit the field when `display === sourceText`** — an absent optional field
preserves the client contract's meaning exactly (`displays[x] !== undefined` still
means "differs from the recognizer"), with no change downstream of the reducer.

**Why the original tripwire would not have caught this:** this phase's stated
signal was "if a web test moves, revert". Web specs pass `repaired` directly as a
prop and never exercise the emit path, so `apps/web` diffs stay empty exactly as
the criteria demand, and the regression would have survived to the Phase 5 browser
run at the earliest.

## Specs change in this phase, not the next

`translation-session-repair.spec.ts` (440 LOC) and `pipeline-display-repair.spec.ts`
(196 LOC) describe the behavior this phase replaces. **Their subject changes here**,
so they are rewritten or deleted here. Deferring them to Phase 4 leaves the suite
red between two phases.

## Related Code Files

- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`
- Modify: `packages/types/src/events/ws-events.ts` — add optional `display` to
  `server.transcript.final` (additive, D10)
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` — populate
  `displays` from the final event
- Replace: `apps/api/.../services/translation-session-repair.spec.ts`
- Delete: `apps/api/.../services/pipeline-display-repair.spec.ts`
- Modify: `apps/api/.../services/translation-session.service.spec.ts`
- **Untouched this phase:** `pipeline-translator.service.ts` (its `repairDisplay()`
  becomes briefly dead but green — acceptable for one phase), `apps/web/**`

## Implementation Steps

1. **Before editing, read the client reducer's ordering assumptions.**
   `turn-keyed-transcript.ts:102,320` renders `display ?? sourceText`.
   **Note what same-tick does and does not buy.** Two `channelFor().emit()` calls
   are two `send`s (`session/event-channel.ts:56-58`), two WS frames, two `message`
   events, two macrotasks; `use-streaming-translate.ts:261` dispatches per event
   with no coalescing. React batches within a task, not across tasks — so a
   same-tick _server_ emit does not guarantee a single _client_ commit. The
   realistic outcome is a one-frame flash of the words-form rather than a 25s swap.
   Record whether that is acceptable, or raise carrying the display string on
   `server.transcript.final` as a schema decision (this plan currently forbids
   schema change, so it is a decision, not an assumption).
2. Import the Phase 2 function; replace the `:348` call with the direction gate,
   the `try/catch`, the sync ITN, the changed-text check, and the emit — preserving
   all four gates above.
3. Delete `repairForDisplay`, `repairsInFlight`, the `MAX_CONCURRENT_DISPLAY_REPAIRS`
   import, and the `recordRepair` call.
4. Rewrite the two specs. Add A6 (at most one display per turn, same tick, only
   when changed), A5 (`segment.sourceText` still RAW), **A15 (inject a throwing ITN
   and assert the turn still delivers audio and closes `completed`)**, and A14 (an
   `en_to_vi` turn takes the defined path).
5. `pnpm -w typecheck && pnpm -w test`. Green before Phase 4 starts.

## Success Criteria

- [x] A6 — at most one display value per turn, same handler tick as
      `transcript.final`, **and none at all when the ITN changed nothing**
- [x] **A15 — an injected throwing ITN does not fail the turn: audio delivered,
      turn closes `completed`**
- [x] **A14 — an `en_to_vi` turn takes the defined path; no Vietnamese ITN over English**
- [x] A turn with no number words emits **zero** display events
- [x] A5 — `segment.sourceText` RAW; `turns[].sourceText` unchanged
- [x] A client without `repairDisplay` receives no display event
- [x] An empty turn emits no display event
- [x] `ws-events.ts` diff is **additive only** — one optional field, nothing removed or retyped
- [x] `apps/web/**` diff is empty; the reducer change is confined to `packages/realtime-client`
- [x] Full typecheck + test green at the end of this phase

## Risk Assessment

**The web-test tripwire is NOT sufficient and must not be relied on alone.** Web
specs feed `repaired` as a prop and never exercise the emit path, so an emit-side
regression leaves `apps/web` diffs empty — which is what the criteria demand. The
real tripwire is the server-side spec asserting **zero** display events for a
numeral-free turn.

**Signal it broke:** a numeral-free turn produces a display event. **Response:**
the changed-text check is missing or comparing the wrong strings.

**Secondary signal:** any web test touching `cascade-panel.tsx` or
`turn-keyed-transcript.ts` changes behavior. Do **not** adjust the web test to
match — that hides a contract change behind a green suite.

**Rollback is one revert** — this phase deletes almost nothing outside the file it
edits. That is why it is separated from the sweep.
