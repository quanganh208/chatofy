---
phase: 2
title: 'Phase 2: Roster and per-turn speaker chip'
status: pending
priority: P1
effort: '1-2d'
dependencies: [1]
---

# Phase 2: Roster and per-turn speaker chip

## Overview

The visible feature. A roster control on `/translate` and a speaker chip on every transcript turn,
tappable to assign or correct. After this phase the product has per-turn attribution that is right
every time, with no model involved.

## Requirements

**Functional**

- [ ] Add and name people before or during a running session
- [ ] Each finished turn shows a chip; tapping it assigns or reassigns a speaker
- [ ] An unattributed turn reads as unattributed, never as a person
- [ ] A turn can be put back to unattributed
- [ ] Adding a person mid-conversation does not interrupt capture

**Non-functional**

- [ ] No new latency on the turn path — every control acts on turns already delivered
- [ ] Meets the project's contrast floors and the accent-once-per-screen rule
- [ ] Keyboard reachable; the chip is a real control, not a click handler on text

## Architecture

**Everything here is post-hoc, and that is the constraint that shapes it.** `cascade-panel.tsx`
states the product's core claim: _"There is no stop button by design ... pressing one costs half a
second of human reaction time, which was the single largest term in the measured latency of the
turn-based page."_ A design that asks someone to identify themselves **before** speaking hands that
half second straight back. So the chip acts on a turn that has already been captured, translated and
rendered — entirely off the latency path.

**The roster is reducer state, and this phase only renders it.** An earlier draft of this plan put
it in `translate/page.tsx` beside `direction`, reasoning that both survive a panel remount. That was
wrong on both halves. `useStreamingTranslate` calls `useReducer` and is itself called from
`CascadePanel`, so nothing in the reducer survives a remount — and a remount releases the microphone,
closes the socket and destroys the transcript anyway, which would leave a surviving roster holding
labels for turns that no longer exist. `direction` is genuinely different: it configures the _next_
session, while the roster describes _this_ one.

**The chip's three states must be visually distinct**, because this is where the design's first
load-bearing rule is actually enforced:

- **confirmed** — a person chose this. Reads settled.
- **suggested** — arrives in Phase 5. Must read unfinished. `ConversationTranscript` already has a
  vocabulary for this: the live line is dashed, italic and at `opacity-80` precisely so that
  something which may still change does not look settled. Reuse it rather than inventing a second
  language for provisionality.
- **fallback** — nobody said. Reads as a question, not as a name.

**Provisional styling must survive the end of the session.** The transcript is read most carefully
after everyone has stopped talking, which is exactly when a suggestion that has quietly turned
definite would be believed. A suggested chip reads suggested in the stopped view too.

Build the third state now even though only `fallback` and `confirmed` can occur. Retrofitting a
provisional style onto a chip that has only ever been definite is how the distinction gets dropped
under time pressure — and it is the rule the whole design rests on.

**Design constraints from `docs/design-guidelines.md`.** The accent appears once per screen, and on
`/translate` that is already spent on the primary action. **A chip is never accent-filled** — with
five people talking there would be a dozen accent marks on screen and the rule would be gone.
Hierarchy comes from size, weight and space. `contrast-floors.spec.ts` fails when a pair slips, so
any new token pair goes in the spec.

**Reuse `packages/ui`.** `badge.tsx` exists; a chip is a badge that is also a control. Prefer
extending it over a new primitive, and only split if the interactive variant genuinely diverges.

**Phase 1 left one action unbuilt, and this phase needs it.** `attributeTurn` only ever writes;
nothing clears an attribution. With removal refused for a speaker who has turns, a roster holding
one person plus one mistaken attribution has no direct way out — the escapes are adding a second
person to re-point at, or renaming the first. So add `transcript.turnUnattributed`.

The distinction that makes this safe rather than a hole in the removal rule: a person explicitly
saying _nobody I have named said this_ is a legitimate `fallback` write. What the removal rule
refuses is different — silently orphaning turns as a side effect of deleting someone. One is a
choice about a turn; the other is a consequence nobody asked for.

**Two speaker concepts will be on this screen, and only one is an identity.** Every
`TranscriptSegment` already carries `speakerRole` (`speaker_a` / `speaker_b`), derived from the
session's direction. The transcript does not render it today, and this phase must not start:
`speakerRole` is a side of a translation, constant for a whole session, and rendering it as if it
named a person is the "unattributed turn renders as a person" rule breaking in through the back
door. The roster is the only source of identity on this screen. Leave `speakerRole` alone.

**Chips belong on finished turns only.** `attributeTurn` accepts any `sessionId`, including one
belonging to a live turn that is later abandoned. That leaves an attribution rendering nowhere
while still making its speaker unremovable. Offer chips on `state.turns` entries; never on the live
overlay.

**The guest control.** Acoustic detection of an unenrolled person is measured dead (36.5% at 5%
false alarm). So adding a person is a plain button, and it must be reachable **from the transcript**,
not only from a roster panel at the top — the moment anyone notices a stranger is speaking is the
moment they are looking at that stranger's turn.

## Related Code Files

- Modify: `apps/web/src/components/translate/conversation-transcript.tsx` — render the chip per turn
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` — wire roster through
- Create: `apps/web/src/components/translate/speaker-chip.tsx`
- Create: `apps/web/src/components/translate/speaker-roster.tsx`
- Create: `apps/web/src/components/translate/speaker-chip.spec.tsx`
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — expose the new reducer actions
- Modify: `apps/web/src/design/contrast-floors.spec.ts` — only if a new token pair is introduced
- Read (do not modify): `packages/ui/src/react/badge.tsx`, `docs/design-guidelines.md`

## Implementation Steps

1. Expose the Phase 1 reducer actions and roster through `useStreamingTranslate`, alongside the
   transcript it already returns. **One dispatch or none** — the hook holds the only `useReducer`,
   and a roster kept beside it in `useState` would be the second source of truth Phase 1's
   architecture note exists to prevent.
2. Add `transcript.turnUnattributed` to the reducer and the roster module, with the spec that a
   turn put back to unattributed frees its speaker for removal.
3. Build `speaker-chip.tsx` with all three visual states. Derive the suggested state from the live
   line's existing dashed/italic/opacity treatment, and check it in the stopped view as well as the
   running one.
4. Build `speaker-roster.tsx`: add, name, remove. Anonymous default labels.
5. Render the chip in `conversation-transcript.tsx`. Keep the left-rule layout — a chip must not
   turn each turn back into a bordered card, which that file records as already tried and rejected.
6. Add the "add a person" control inside the transcript, not only in the roster panel.
7. Extend the empty state: it currently tells a new user what to do, and it is the natural place to
   say people can be added.
8. Specs: assigning writes through to the reducer; an unattributed turn renders the fallback and
   not a name; the chip is keyboard reachable; adding a person mid-session does not remount the
   panel and drop the microphone.

## Success Criteria

- [ ] A turn can be attributed and re-attributed in one tap each
- [ ] An unattributed turn never renders a person's name
- [ ] A turn can be returned to unattributed, and that frees its speaker for removal
- [ ] `speakerRole` is not rendered as an identity anywhere
- [ ] Adding a person mid-session leaves capture running — verified, not assumed
- [ ] No accent-filled chip; `contrast-floors.spec.ts` passes
- [ ] Chip is reachable and operable by keyboard
- [ ] A suggested chip still reads as provisional after the session has stopped
- [ ] `pnpm --filter @chatofy/web test`, `lint`, `typecheck` pass
- [ ] The transcript keeps its left-rule rhythm at 12+ turns with 5 speakers

## Risk Assessment

- **The chip turns the transcript into a wall of boxes.** `conversation-transcript.tsx` records that
  twelve identical bordered boxes have no rhythm and a long conversation becomes unscannable — that
  was tried and reversed. Signal: the 12-turn 5-speaker check reads as a grid. Response: the chip is
  typographic, sharing the turn's left rule; it does not get its own border.
- **Naming five people is friction before anything has happened.** Signal: the roster becomes a
  setup form standing between the user and the first translation. Response: default anonymous
  labels, and let the roster grow from the transcript as people speak. Nobody should have to fill
  in a form to start talking.
- **Mid-session roster edits remount the panel.** `cascade-panel.tsx` releases the microphone and
  the socket through its own unmount cleanup, so a remount silently ends the conversation. Signal:
  the mid-session test shows capture stopping. Response: adding a person is a reducer dispatch and
  nothing more — no key change, no conditional mount, no prop that reorders the tree. This is the
  failure most likely to be missed by hand-testing, because it looks like the user pressed stop.
- **The roster ends up in `useState` beside the reducer.** The likeliest shortcut in this phase,
  and it reproduces exactly the two-sources-of-truth problem Phase 1 was shaped to avoid. Signal: a
  `useState` holding speakers anywhere in `apps/web`. Response: everything goes through the hook's
  single dispatch.
- **The roster vanishing on remount reads as a bug and gets "fixed".** It is the no-persistence
  guarantee, and hoisting roster state above the panel to stop it would quietly undo the constraint.
  Signal: someone proposes lifting it to the page. Response: make the reset visible in the UI
  instead — losing names when the conversation ends is the behaviour, not a defect.
- **The suggested state is built and never exercised until Phase 5.** Signal: a reviewer proposes
  deleting it as dead code. Response: refuse and point at the plan's rule 1. It is cheaper to carry
  an unused visual state for one phase than to add provisionality to a chip that has spent a release
  looking definite.
