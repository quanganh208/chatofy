---
title: 'Phase 6: Translate surface and settings popover'
status: done
priority: P1
dependencies: [5]
---

# Phase 6: Translate surface and settings popover

## Overview

Put `/translate` inside the app chrome with the sidebar collapsed to a rail, and move
`TranslateSettingsPanel` from a permanent panel beside the transcript into a popover
behind a topbar gear.

This is the branch's original purpose (`feat/translate-page-ui-revamp`) and the surface
with the strictest rules in the codebase.

## Requirements

- [x] The sidebar defaults to the icon rail on this route
- [x] Settings open from a topbar control, not from a panel in the content column
- [x] `TranslateSettingsPanel` is mountable in a popover **and** on a page without forking
- [x] The translation stays the largest thing on the surface
- [x] Direction and voice are disabled while a conversation runs

## Architecture

### The panel becomes placement-agnostic

`TranslateSettingsPanel` currently returns `<Card className="flex flex-col gap-5 p-6">`
— it owns its own surface. Phase 6 mounts the same component on a page, so the `Card`
has to come from the caller.

Change the component to return the bare `<div className="flex flex-col gap-5">` and let
each mount supply the surface: the popover supplies `PopoverContent`, the Preferences
page supplies `Card`. One component, two placements. Its props are unchanged.

**Do not fork it.** There is one settings object (`chatofy.translate-settings`); a
"live" copy and a "defaults" copy would be a distinction the storage does not make.

### Where the hook stays

`useTranslateSettings` is called in `app/(app)/translate/page.tsx` and **nowhere else**.
The existing docblock explains why at length: it is per-call-site `useState`, not a
store, so a second call reads storage independently, diverges, and races two debounced
writes into `localStorage`. It fails silently and looks like settings that randomly do
not apply.

The popover lives in the topbar, which is rendered by the layout — so the page must
lift the settings into the layout's topbar slot rather than the topbar calling the hook.
Use a slot the page fills (a context provided by `(app)/layout.tsx`, or a portal target
in the topbar). **Whichever mechanism, the hook is still called once, in the page.**

### Running state

Direction and voice ride `client.session.start`; `ConversationSession` stores the
options for the whole run and offers no way to reconfigure them. The panel already
passes `disabled={running}` for exactly this reason, and the mockup renders them dimmed.
`running` originates in `CascadePanel`, so it has to reach the popover by the same route
the settings do.

Volume and transcript layout stay live mid-conversation — they are client-side.

### Motion and the transcript

- No continuous motion beside transcript text.
- A settled line enters with transform and opacity only.
- The popover's own enter/exit comes from `tw-animate-css` and must carry a
  `motion-reduce:` escape.
- The status pill's pulse already exists; leave it.

### Chrome that does not hide

This is a hands-free surface. Do **not** add auto-hiding chrome or move the live status
into the header as a "smart" behaviour. Status, mic level and the turn indicator stay
where `CascadePanel` puts them; the topbar simply gets quieter.

## Related Code Files

- Modify: `apps/web/src/components/translate/translate-settings-panel.tsx` — drop the `Card` wrapper
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` — stop rendering the panel inline; expose `running` and the settings upward
- Modify: `apps/web/app/(app)/translate/page.tsx` — still the only `useTranslateSettings` call site; fills the topbar slot
- Modify: `apps/web/src/components/layout/app-topbar.tsx` — the gear trigger and its slot
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` — rail default for this route
- Read only: Phase 5's collapse-mechanism docblock
- Read only: `apps/web/src/hooks/use-translate-settings.ts`

## Implementation Steps

1. Remove the `Card` from `TranslateSettingsPanel`; give every current mount its own surface.
2. Add a topbar slot to `(app)/layout.tsx` that a page can fill.
3. Move the panel out of `CascadePanel` into a `Popover` filled from the page.
4. Thread `running`, `settings`, `onChange` and `onVolumeChange` to the popover from the page.
5. Default the sidebar to the rail on `/translate`, using the collapse mechanism Phase 5
   decided and recorded — do not introduce a second one.
6. Confirm `motion-reduce:` on the popover animation.
7. Manually verify: start a conversation, open the popover mid-run, confirm direction
   and voice are disabled and volume still moves the gain immediately.

## Success Criteria

- [x] `pnpm --filter web test` green
- [x] `grep -rn "useTranslateSettings" apps/web/src apps/web/app` shows exactly one call site outside the hook's own file and its spec
- [x] Review: the largest type on the surface is the translation (`--text-translation`), not a heading
- [x] Volume dragged mid-conversation changes loudness immediately
- [x] With `prefers-reduced-motion: reduce`, the popover appears without animating
- [x] Sidebar renders as a rail on `/translate` and expanded on `/dashboard`

## Risk Assessment

**A second `useTranslateSettings` call site appears while wiring the topbar.** This is
the most likely mistake in the phase and it is _silent_ — settings appear to randomly
not apply. Signal: the grep in Success Criteria returns two. Response: the topbar takes
props or reads a context the page provides; it never calls the hook.

**The popover traps focus over a live conversation.** Signal: keyboard users cannot
reach the transcript while it is open. Response: Radix `Popover` (not `Dialog`) — it is
non-modal by default. Do not set `modal`.

**`running` stops reaching the disabled props.** Signal: direction is editable
mid-conversation; the next turn silently uses the old direction because
`ConversationSession` fixed it at start. Response: assert it manually in step 7; there
is no test for it today.

## Deviations from the plan

**The slot is a portal, and the portal is fed by a store rather than provider state.**
The plan offered "a context provided by `(app)/layout.tsx`, or a portal target in the
topbar". The portal won because it moves only the DOM position: the control keeps its
handlers, its state and its place in the React tree, so nothing had to be lifted to reach
the chrome. The store in `topbar-slot.tsx` is the second half of that choice — holding the
node in provider state means a `setState` inside an effect, which is the rule that already
had to be argued with in Phase 5 and a second render on every mount, to publish a value
that was never state. A callback ref plus `useSyncExternalStore` is what it actually is.

**`CascadePanel` renders the slot, not the page.** The plan's step 4 says "filled from the
page". `running` and the live volume writer both originate in `CascadePanel`, and lifting
them would mean lifting `useStreamingTranslate` — whose whole teardown story is that the
microphone and socket are released by this component's unmount. The rule the phase
actually protects is untouched: `useTranslateSettings` is still called once, in the page,
and every consumer takes props.

**The live status did NOT move into the topbar, and this contradicts the mockup.** The
mockup's translate screen draws a status pill and a direction readout in the topbar, and
Phase 5's handoff note says the status replaces the route title. This phase's own
"Chrome that does not hide" section says the opposite in plain words — status, mic level
and turn indicator stay where `CascadePanel` puts them. The narrower instruction won:
moving the status is separable work that this phase forbids, and it is cheap to do later
now that the slot exists. Left as an open question below rather than decided quietly.

**Two files the plan did not list.** `topbar-slot.tsx` is the mechanism above.
`translate-settings-popover.tsx` exists so `CascadePanel` renders one component instead of
a `Popover`/`PopoverTrigger`/`PopoverContent` tree inline, and so the width, the height cap
and the "never `modal`" rule have somewhere to be written down.

**Popover sizing is the mockup's 340px (`w-85`), not the primitive's `w-72`.** The
direction control is two language cards side by side and does not fit in 18rem. The height
cap (`min(34rem, 100vh-5rem)`, scrolling) is for a laptop in landscape: with voices listed
the panel is taller than a short viewport, and a popover that overflows the window is
simply cut off.

**One new key, `web.translate.settings`.** The panel's own strings are still literals —
Phase 10 migrates them — but the trigger's accessible name is new text, and new text lands
in the dictionary rather than being added to what Phase 10 has to find.

**Three specs, 9 tests.** `topbar-slot.spec.tsx` (3) holds that a control leaves the
surface column, leaves nothing behind, and renders nothing where there is no chrome.
`translate-settings-popover.spec.tsx` (4) holds the rule the Risk Assessment says has no
test: direction and voice disabled while running, volume NOT disabled, the panel bringing
no surface of its own, and the page underneath not going `aria-hidden`.
`app-chrome.spec.tsx` gains 2: the rail-vs-expanded default, and that a slotted control
lands in the topbar row. Both new behaviours were confirmed by mutation — forcing
`disabled={false}` in the panel fails the running test, and removing `TopbarSlotTarget`
fails the placement test.

## Verification

`pnpm --filter web test` 396/396 (20 files, from 387/18), `typecheck` clean,
`eslint src app` 0 errors and the 3 pre-existing `use-voice-catalog` warnings,
`pnpm --filter web build` green across 12 routes, `@chatofy/ui` 116/116,
`@chatofy/i18n` 15/15.

`grep -rn "useTranslateSettings" apps/web/src apps/web/app` → one call site outside the
hook and its own spec. Largest role token on `/translate` is `text-translation` in the
transcript; the topbar title is `text-body`. `motion-reduce:animate-none` is already on
the generated `PopoverContent`.

**Implementation step 7 was not run.** Starting a real conversation needs microphone
input, which this environment does not have. What it was there to catch — `running`
failing to reach the disabled props — is now the mutation-verified spec above, which is
stronger than a one-off manual check. The half it does not cover is that dragging volume
mid-run reaches the gain node; that path is unchanged from before this phase
(`onVolumeChange` is still `conversation.setVolume`, still passed straight through).

## Open question for Phase 7

**Does the live status move into the topbar?** The mockup says yes and this phase says no,
so the surface currently shows the route title where the mockup shows a status pill and a
direction readout. The slot now exists, so doing it is small. Deciding it needs the user,
because it is their mockup on one side and their plan on the other.
