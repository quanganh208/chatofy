---
title: 'Phase 6: Translate surface and settings popover'
status: todo
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

- [ ] The sidebar defaults to the icon rail on this route
- [ ] Settings open from a topbar control, not from a panel in the content column
- [ ] `TranslateSettingsPanel` is mountable in a popover **and** on a page without forking
- [ ] The translation stays the largest thing on the surface
- [ ] Direction and voice are disabled while a conversation runs

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

- [ ] `pnpm --filter web test` green
- [ ] `grep -rn "useTranslateSettings" apps/web/src apps/web/app` shows exactly one call site outside the hook's own file and its spec
- [ ] Review: the largest type on the surface is the translation (`--text-translation`), not a heading
- [ ] Volume dragged mid-conversation changes loudness immediately
- [ ] With `prefers-reduced-motion: reduce`, the popover appears without animating
- [ ] Sidebar renders as a rail on `/translate` and expanded on `/dashboard`

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
