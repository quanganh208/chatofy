---
phase: 5
title: 'Web translate surface redesign'
status: pending
priority: P1
effort: '2-2.5d'
dependencies: [3, 4]
---

## Overview

The phase that actually makes it look finished, and the only one that does.
Tokens move roughly 15% of perceived quality; hierarchy, state and rhythm in
`apps/web/src/components/translate/*` move the rest. Today these are working
forms with no visual hierarchy, no empty/loading/error treatment beyond a line
of grey text, and no motion.

**Ships as two PRs.** The split is drawn up front rather than under deadline,
because the two halves need different reviews and the second half is the one
that slips.

## Requirements

- Functional: every state the hooks already expose is visually distinct — `idle`, `connecting`, `listening`, `hearing-speech`, `translating`, `playing`, `stopped`, plus `muted`, `error`, and the live path's language mismatch.
- Non-functional: no change to hook APIs, no change to which panel mounts when, `prefers-reduced-motion` respected, focus-visible on every control, `conversation-state.spec.ts` untouched and passing.

## Architecture

The structural problem is that everything has the same weight. `/translate`
stacks a mode card, a settings card and a transcript, all the same size, border
and padding — so nothing tells the eye where the product is. The translation is
the product; the settings are not.

**5a — mechanical.** New primitives and a port with identical public props.
Reviewable as "does it still render and behave the same": `segmented-control.tsx`,
`status-indicator.tsx`, the `button.tsx` variant rework, and moving the three
toggles onto the segmented control. No layout change lands here.

**5b — judgment.** Reviewable only as "does it look right": the `/translate`
layout inversion, both panels, transcript rhythm, motion.

Three changes carry the redesign:

**1. Invert the hierarchy.** The translated text becomes the largest element on
the page. Source text sits above it, smaller and muted. Controls collapse into a
single bar rather than three stacked cards. `ModeToggle`, `DirectionToggle` and
`VoiceGenderToggle` become segmented controls — they are one-of-N choices and
currently render as two unrelated buttons each.

**2. Make status a state, not a sentence.** `STATUS_LABEL` in both panels maps
status to prose rendered as grey text beside a spinner. Add the state colour
from phase 3: `live` while capturing, `speaking` while a translation plays,
`accent` while translating, muted neutral when idle. **The prose label stays.**
That is not incidental — `live` red and `speaking` green as adjacent status dots
is the textbook deuteranopia collision, and the label is what makes the states
distinguishable at all for a red-green colour-blind user. Treat it as a
requirement: the two states also differ in behaviour, `live` pulses and
`speaking` does not.

**3. Give the transcript rhythm.** `ConversationTranscript` renders every turn
as an identical card. Turns need a speaker side, a settled/unsettled distinction
(the live line already carries italic + opacity — keep the meaning, raise the
contrast), and enough spacing that a long conversation is scannable. The overlay
already solved this with `.line.mine` — a left rule and an indent. Reuse the
idea so the two surfaces rhyme.

Motion stays minimal: the level meter that already animates, a status colour
crossfade, and an entrance for a newly settled turn. All behind
`prefers-reduced-motion`. Nothing that delays reading a translation.

**Do not extract components into `packages/ui` in this phase.** These are web
DOM components with app-specific state; the extension cannot use them and mobile
does not exist. The YAGNI trigger has still not fired for components.

`app/page.tsx` is **out of scope** — it is an unrelated 8-line file and does not
belong in a redesign PR.

## Related Code Files

**5a**

- Create: `apps/web/src/components/ui/segmented-control.tsx`
- Create: `apps/web/src/components/ui/status-indicator.tsx`
- Modify: `apps/web/src/components/ui/button.tsx` — real hover/active states, a `live` variant
- Modify: `apps/web/src/components/translate/mode-toggle.tsx`, `direction-toggle.tsx`, `voice-gender-toggle.tsx`

**5b**

- Modify: `apps/web/app/translate/page.tsx`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx`, `live-panel.tsx`
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Modify: `apps/web/src/components/translate/result-card.tsx`, `audio-source-controls.tsx`

## Implementation Steps

### 5a

1. Build `segmented-control.tsx` — one-of-N, arrow-key navigable, `role="radiogroup"`, and a disabled state that reads as unavailable rather than merely faded.
2. Build `status-indicator.tsx` — takes a status string and a state colour, renders dot + label, `aria-live="polite"`. Both panels' `STATUS_LABEL` maps feed it unchanged. Live pulses; speaking does not.
3. Rework `button.tsx` variants: real hover/active background steps from the token scale instead of `hover:opacity-90`, and a `live` variant for stop actions so `destructive` keeps its own meaning.
4. Port the three toggles onto the segmented control with **identical public props**, so no panel changes in this PR.
5. Verify `disabled={running}` still holds the mode and direction toggles during a session, by hand, in both modes. A segmented control makes this easy to get subtly wrong.
6. Run `pnpm --filter web test`, `typecheck`, `lint`, `build` — separately.

### 5b

7. Rebuild the `/translate` layout: one controls bar, one primary surface, transcript below. The mode toggle moves into the bar rather than owning a card.
8. Rework `cascade-panel.tsx` and `live-panel.tsx` around the new hierarchy. Keep every hook call, every effect, and the `onRunningChange` contract exactly as they are.
9. Rework `conversation-transcript.tsx`: speaker sides, settled vs live styling, spacing rhythm, and an empty state that says what to do rather than rendering nothing.
10. Add motion behind `prefers-reduced-motion`; verify with the media query forced on.
11. Accessibility pass: focus-visible on every control, the contrast table from `docs/design-guidelines.md` applied to the 11/12px labels, and confirm the level meter keeps `role="meter"` and its `aria-value*` attributes.
12. Run the four commands again, then walk both modes by hand against a live api.
13. **Visual checkpoint:** the side-by-side screenshot of `/translate` and the overlay from the plan's success criteria. Dated. This is the artifact that makes "we ran out of time" visible on day 3 rather than day 4.

## Success Criteria

- [x] Every status the two hooks expose is distinguishable without reading the label — and still distinguishable with the colours removed
- [x] Translated text is the largest element on the page
- [x] The three toggles are one segmented control component, not six buttons
- [x] `prefers-reduced-motion: reduce` removes all added animation
- [x] No hook signature, effect, or mount condition changed
- [x] `apps/web/src/state/conversation-state.spec.ts` passes untouched
- [x] `app/page.tsx` untouched
- [x] `pnpm --filter web test`, `typecheck`, `lint`, `build` each pass

## Risk Assessment

- **Presentation work drifts into hook changes** and breaks a session path that only shows up live. Signal: a diff line inside `use-live-translate.ts`, `use-streaming-translate.ts`, or an effect body. Response: those files are out of scope; if one genuinely must change, stop and replan rather than fold it in.
- **This phase is the only one that delivers the outcome, and it is the largest.** If the plan slips, the surviving artifact is a re-coloured app that looks as unfinished as today, plus a token package. Signal: 5b not started by the end of day 2. Response: 5a runs in parallel with phase 6 — they own disjoint files and both depend only on phase 3 — and 5b's step 13 checkpoint is the tripwire.
- **The estimate is optimistic.** ~700 LOC of judgment work plus two new primitives. Signal: 5a alone taking more than a day. Response: that is the early read on whether 5b fits at all; re-scope then, not at the end.
- **Colour-blind collision between `live` and `speaking`.** Signal: a reviewer suggesting the label is redundant now that there is a colour. Response: it is not; see Architecture point 2.
- **Scope inflation into a marketing page.** Signal: hero sections, feature grids. Response: `docs/project-overview-pdr.md:33` descopes the full web app, and `app/page.tsx` is out of scope for this phase entirely.
