---
phase: 5
title: 'Display-only turn merge'
status: completed
priority: P1
effort: '2d'
dependencies: []
---

# Phase 5: Display-only turn merge

## Overview

One utterance should read as one block with one speaker prompt, however many
translation turns the 8s ceiling cut it into. Presentation only — no VAD
constant moves, no latency price, no change to how audio was chunked.

## Why this phase exists — measured

Driving the repo's real `SpeechGate` with a trace matching the reported reading
(~11s, commas at natural places):

| Run | Config                             | Result                                                                        |
| --- | ---------------------------------- | ----------------------------------------------------------------------------- |
| A   | as shipped, `maxUtteranceMs: 8000` | **2 turns**, first closes `forced` at 8.62s                                   |
| B   | ceiling removed                    | **1 turn**, closes on hangover                                                |
| C   | ceiling 15s                        | **1 turn**, closes on hangover                                                |
| D   | sensitivity, no ceiling            | a pause must reach **500ms** to split; read-aloud commas (180–300ms) never do |

So the split is `MAX_UTTERANCE_MS = 8_000` at
`apps/web/src/hooks/use-streaming-translate.ts:45`, not the hangover. The gate
arms at 7.5s looking for a quiet block, finds only speech, then hits the hard
ceiling and cuts **mid-word** at 8.0s of turn time — which `capture-pump.ts`
names itself: "the turn is cut mid-word. Worse for translation quality than a
pause would be."

This is structural: under an 8s ceiling _any_ utterance over 8s splits, however
cleanly spoken. The ceiling stays — it exists so a translation cannot fall
arbitrarily far behind the speaker, and raising it has a real latency cost. This
phase fixes the visible harm without paying that cost.

## Requirements

- Functional: adjacent finished turns closed by a forced cut, same unmarked
  speaker, within a short window, render as one block with one speaker prompt.
- Non-functional: translation turn count and `cutForced` rate unchanged and
  asserted so. Zero audio-path change.

## Architecture

`conversation-transcript.tsx:113` currently maps one `<li>` per
`TranscriptSegment` keyed on `turn.id`, with one `SpeakerChip` per
`turn.sessionId`. The change is a grouping pass before that map, plus one chip
per group.

Grouping helper belongs in `packages/realtime-client/src/state/`, beside
`liveTurnsInOrder` — it is presentation-shaping over transcript state, the same
job, and it is pure so it can be unit-tested without a DOM.

**Merge predicate** — all must hold:

- previous segment was closed by a forced cut (`cutForced`)
- adjacent in `turns` order
- neither segment is confirmed-attributed to a _different_ speaker
- within a short wall-clock window (the next turn opens ~130ms after a cut)

**Rendering contract shared with Phase 4 — write it identically in both files.**
The reducer stores `displayText` **keyed by `sessionId`**, one per member turn.
`groupTurnsForDisplay` concatenates `displayText ?? sourceText` per member. Because
grouping is a pure derivation, a repair arriving for any member at any time simply
re-renders the block — there is no ordering rule to get wrong, and merging must
never become stateful.

**Seam quality across a forced cut.** Gemini repairs each fragment independently
(prompt rule 5 forbids continuing a cut fragment), so member 1's repair may gain a
terminal period and member 2's a mid-utterance capital. Decide and record which:
strip trailing terminal punctuation from non-final forced-cut members at join
time, or accept the roughness in v1. Either is defensible; leaving it undecided is
not.

**A confirmed attribution always splits a group.** If a person has said these are
two different speakers, the display must not merge them. That is the same rule
`speaker-centroids.ts` states for suggestions: a confirmation always wins.

**Where `cutForced` comes from — verified, and it is not the wire.**
`ws-events.ts:233` carries it on `clientTurnMetricsSchema`, which is a
**client -> server** event. It travels the wrong direction, and
`transcriptSegmentSchema` (what `server.transcript.final` carries) has no such
field. The server never sends it back.

The client does own it, but **not keyed the way a first reading suggests** —
verified, after an earlier draft of this phase got it wrong:

- `turn-pipeline.ts:165` — `closedMetrics = new Map<string, CapturedTurnMetrics>()`
- `turn-pipeline.ts:499` — `closedMetrics.set(turn.turnId, this.snapshot(turn))`
- `turn-pipeline.ts:291` — `closedMetrics.get(turnId)`

The map is keyed by **`turnId`**. `sessionId` is a **nullable field on the value**
(`turn-pipeline.ts:151`, `sessionId: string | null`). There is no sessionId-keyed
record in that file. Three consequences this phase must handle:

1. **`sessionId` can be null at snapshot time.** A turn held by the in-flight
   ceiling is `phase: 'waiting'` with `sessionId: null` until `server.session.ready`.
   `conversation-session.ts:587` already early-returns on exactly this
   (`if (!captured?.sessionId) return`). With `MAX_IN_FLIGHT = 3` and an 8s ceiling,
   **the held-then-cut turn is the common case, not the exotic one** — and for it,
   no join key exists at snapshot time.
2. **Timing.** `cutForced` is set in `closeCapturedTurn()` (`:326`) but reaches the
   app via `onTurnClosed` fired from `forget()` (`:507`), which runs when the
   SERVER closes the turn — i.e. AFTER `server.transcript.final`. The two halves
   render un-merged first, then snap together. Either hold the segment until the
   flag lands (visible transcript latency) or accept a re-layout pop. **Decide and
   record which.**
3. **No existing callback surface.** `conversation-session.ts:602` reads `cutForced`
   only inside `sendTurnMetrics`. This needs a new handler on `ConversationSession`,
   new wiring in `use-streaming-translate.ts` (which today passes only
   `onServerEvent`, `onReset`, `onTurnAbandoned`, `onLog`), a new reducer action,
   and a new state field.

Still **no wire change, no schema change, no server change** — but "the client
already owns it" understates the work considerably.

**Carry `openedAt` and a capture-order index in the same payload.** `openedAt`
already exists on `CapturedTurnMetrics` (`turn-pipeline.ts:298`) and is real
capture time. It is needed for ordering and for the merge window — see Risks.

## Related Code Files

- Create: `packages/realtime-client/src/state/display-groups.ts`
- Create: `packages/realtime-client/src/state/display-groups.spec.ts`
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Create: `apps/web/src/components/translate/conversation-transcript.spec.tsx` (does NOT exist today — the component has zero test coverage, and this phase's entire delivery lives in it)
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` (cutForced/openedAt wiring)
- Modify: `packages/realtime-client/src/conversation/conversation-session.ts` (new handler)
- Read only: `packages/realtime-client/src/state/turn-keyed-transcript.ts`
- Read only: `packages/realtime-client/src/state/speaker-roster.ts` (`speakerFor`, attribution origin)

## Implementation Steps

1. Surface `cutForced` from `conversation-session.ts` into transcript state,
   keyed by `sessionId`, so the grouping helper can read it beside the finished
   segment. Client-side only — do NOT add it to `transcriptSegmentSchema` or to
   any server event; the server does not have it and does not need it.
2. Write `groupTurnsForDisplay(turns, attributions)` — pure, no DOM.
3. Unit-test the predicate: forced-cut pair merges; hangover-closed pair does not;
   a confirmed attribution to different speakers splits; a long gap splits;
   a three-turn cut chain merges into one group.
   3b. Test the Phase 4 composition even though Phase 4 lands later: a `displayText`
   arriving for the MIDDLE member of a 3-turn merged group re-renders the block
   with that member repaired and the others untouched. Build the reducer shape now
   so Phase 4 rebases onto it rather than reshaping it.
4. Render groups: one `<li>` per group, one `SpeakerChip` per group, source and
   target text concatenated in order.
5. Attribution wiring: attributing a group attributes **every** session id in it.
   `onAttribute` is per-session today; the group needs all of them.
6. Assert `cutForced` rate and translation turn count unchanged against baseline.

## Success Criteria

- [x] Reproduction passage renders as ONE Vietnamese block with ONE speaker prompt
- [x] Grouping helper is pure and unit-tested over all five predicate cases
- [x] Attributing a merged group attributes every session id within it
- [x] A confirmed attribution to different speakers always splits the group
- [x] Translation turn count and `cutForced` rate unchanged from baseline, asserted
- [x] No change to any VAD constant — `git diff` touches no `speech-gate.ts` / `capture-pump.ts` constant
- [x] No change to `transcriptSegmentSchema` or any server event — the join is client-side
- [x] `displayText ?? sourceText` rendering contract implemented, matching Phase 4's spec verbatim
- [x] Test: display event for the middle member of a 3-turn group re-renders correctly
- [x] Seam-handling choice recorded (strip terminal punctuation vs accept roughness)

## Outcome (implemented 2026-08-27)

Shipped. `groupTurnsForDisplay` in `packages/realtime-client/src/state/display-groups.ts`
is a pure derivation over turn state; `cutForced`/`openedAt`/`closedAt` reach it
via a new optional `onTurnCaptured` listener on `ConversationSession`, dispatched
into two new reducer fields (`captures`, `displays`). No wire change, no schema
change, no server change, no VAD constant touched — verified by diff.

**Verification:** realtime-client 249 tests + tsc 0; web 503 tests + tsc 0 + production
compile; extension 200 tests + tsc 0 (it consumes `TurnKeyedTranscript` and was the
widest regression risk — it builds from `initialTurnKeyedTranscript`, so it inherited
both new fields). Lint clean on every changed file. Three pre-existing
`react-hooks/set-state-in-effect` errors remain in files this phase never touched.

**Three bugs caught before merge, two by review and one by the tests:**

1. _The merge gap measured the wrong interval._ First written as
   `openedAt → openedAt`, but a turn cut at the 8s ceiling has its neighbours'
   opens ~8s apart however continuous the speech. The interval that says the
   speaker never stopped is `closedAt → openedAt`, ~130ms. As first written, the
   exact case this phase exists for would never have merged.
2. _The sort comparator was not a total order._ Returning 0 when either side
   lacked a capture record left capture-bearing turns uncompared — reproduced on
   V8: `[B(100), A(none), C(50)]` came back `B, A, C`, and six turns with three
   records came back entirely unsorted. Now the recorded turns are sorted among
   themselves and written back into their own slots.
3. _The chip hid a confirmed attribution on a non-first member._ A group splits
   only when both sides are confirmed and disagree, so a group can hold one
   confirmed member beside unattributed ones — routinely, because capture records
   arrive after their segments and the halves render separately in that window.
   Reading `sessionIds[0]` showed `fallback` while state said otherwise, and the
   next tap would overwrite a confirmation the screen never showed.

Both regression tests were verified to FAIL without their fix.

**Decision recorded — the re-layout pop.** Capture records arrive after
`server.transcript.final`, so the halves render un-merged and then snap together.
Accepted rather than holding segments until the flag lands, which would add
transcript latency to every turn to smooth a transition on the minority that get
cut. Pinned by the test `renders un-merged before the capture records land`.

**Seam handling — decided:** members are joined with a single space and the
mid-word seam is left as it falls. Repairing it would mean inventing a word
neither half contains, which is what prompt rule 5 forbids the translator to do.

**Known consequence for the thesis, NOT fixed here:** `attributionStats.tapRate`
(`packages/realtime-client/src/state/attribution-stats.ts`) counts confirmed turns
over total turns. One tap on a 3-member group now confirms 3 turns where it used
to take 3 taps, so the field measures label coverage rather than tap effort. It is
documented as a tap rate and is reported in the thesis. Needs a decision: rename
and re-document, or divide by display groups.

**Note for the acoustic layer:** only confirmed turns seed a voice profile
(`speaker-centroids.ts`), so once suggestions are enabled, one tap on a wrongly
merged block would fold a second person's voice into one centroid. The merge is
display-only today; that is what would make it acoustically load-bearing. Comment
left at the fan-out site.

### Correction (2026-08-28): the merge threshold shipped mis-calibrated

`MAX_CAPTURE_GAP_MS` shipped at 400ms, reasoned from a single ~130ms observation
and from an argument that it sat "comfortably under the gate's 500ms hangover".
Both were wrong. The bound governs how long the gate takes to RE-OPEN on
continuing speech, which the hangover does not limit: re-opening waits for the
level to clear the adaptive floor for `MIN_SPEECH_MS`, and after a cut that landed
on a quiet block the next syllable can be soft.

Measured by replaying three real recordings of one speaker through the real
`CapturePump` at ceilings from 4s to 10s — 22 forced cuts: min 128ms, median
202ms, p90 427ms, **max 597ms**. At 400ms only 18 of 22 merged, and at the shipped
8s ceiling **two of the three recordings did not merge at all** — so the fix this
phase delivered did not fire on real speech.

Raised to 1200ms, twice the observed maximum. Widening is safe because `cutForced`
is what keeps separate utterances apart, not this bound: a turn that ended on the
hangover never reaches the check. Three regression tests pin the measured gaps
(597 / 448 / 277) and fail at 400ms; a fourth pins the bound itself.

This is the `TAU_SUGGEST` lesson repeating inside the plan that cites it — a
threshold chosen without the real channel. The gaps came from the user's own
recordings, which is the only reason it was caught.

## Risk Assessment

- **Temptation to add `cutForced` to the domain schema.** It is a capture-side
  fact about how a turn ENDED, not part of the persisted transcript record, and
  the server has no way to know it. Signal: a diff touching
  `packages/types/src/domain/transcript.ts` or `server.transcript.final`.
  Response: reject it — the join is client-side on `sessionId`. Widening the
  persisted domain record for a presentation concern is the wrong trade.
- **`turns` is COMPLETION order, not speaking order.** BLOCKING.
  `turn-keyed-transcript.ts:341` appends on arrival; `MAX_IN_FLIGHT = 3`. If the
  ceiling cuts an utterance into A then B, and A's translation walks the ladder on
  a 429 while B reuses a speculation, `turns` = [B, A] — and "adjacent in `turns`
  order" renders the utterance BACKWARDS. The reducer concedes the point at
  `:366`: "The pipeline owns real speaking order." Response: sort on `openedAt`
  from the client-side join, or gate merging on `MAX_IN_FLIGHT === 1`.
- **The merge window has no clock to read.** BLOCKING. The only timestamp on
  `TranscriptSegment` is `createdAt`, set at `turn-session.ts:255` when the SERVER
  finished translating — not when the utterance was spoken. With p50 1163ms /
  p95 2983ms translate latency and 3 turns in flight, the gap between two
  `createdAt`s is the difference of two translation durations: routinely seconds,
  sometimes negative. A tight window misses the target case; a loose one merges
  strangers. Response: use `openedAt`, which is real capture time.
- **Merging hides a real speaker change.** Two people alternating fast, neither
  attributed, could be merged into one block. Signal: a merged group whose halves
  are later attributed to different people. Response: the confirmed-attribution
  rule splits it; keep the wall-clock window tight so unattributed fast alternation
  does not merge on time alone.
- **Phase 4 modifies this same component.** `conversation-transcript.tsx` is
  touched by P4 step 7 (normalized line + raw toggle) and P5 step 4 (group
  rendering). Logically independent, NOT parallel-safe. Signal: both phases handed
  to concurrent implementers. Response: Phase 5 lands first; Phase 4 rebases onto
  the group rendering. Declared as `dependencies: [2, 5]` on Phase 4.
- **Overlap with pending UI plans.** `conversation-transcript.tsx` is also touched
  by `260825-0953-translate-page-ui-revamp`, `260825-1627-web-ia-and-ui-revamp`,
  and `260825-1102-speaker-attribution-on-web`. Signal: merge conflict in that
  file. Response: this is a merge-conflict risk, not a hard dependency — see the
  cross-plan note in `plan.md`; confirm ordering with the user before starting if
  any of those are in flight.
- **Concatenation across a mid-word cut reads badly.** The boundary landed
  mid-word, so joining the two source texts may produce a broken word.
  Signal: the merged Vietnamese reads worse than the two separate lines.
  Response: join with a space and accept it; do NOT attempt to repair the seam —
  that is Phase 4's job and doing it here would duplicate the concern.
