---
title: 'Phase 3: Transcript layout setting'
status: todo
priority: P1
effort: '3h'
dependencies: [1, 2]
---

# Phase 3: Transcript layout setting

## Overview

The user's explicit "chia làm 2 bên hoặc theo list": `ConversationTranscript` gains
a two-column mode (source | translation) alongside today's stacked list, chosen at
runtime and persisted.

## Requirements

- Functional: a control in the settings panel switches stacked ↔ columns; the choice
  applies immediately and survives reload; live (in-progress) turns render correctly
  in both modes.
- Non-functional: two-column collapses to stacked below `sm` automatically; the
  translation keeps its typographic primacy in both modes.

## Architecture

`ConversationTranscript` takes `layout: 'stacked' | 'columns'`. Both modes render
the same turn data (`conversation-transcript.tsx:56-76`) — this is a presentation
fork, not two components.

**Keep the deliberate hierarchy in both modes.** The component's own rationale
(`:24-27`) is that the translation is set larger than the source because it is the
thing being read; when both were equal the eye had to be told which line to look at
every turn. Columns must not flatten that — translation stays
`text-translation font-medium`, source stays `text-prose text-body`.

**Responsive collapse is mandatory, not optional.** Two prose columns do not fit a
phone. Implement as `grid-cols-1 sm:grid-cols-2` so the collapse is CSS, not state —
a JS breakpoint would produce a hydration mismatch and a flicker.

**Live turns in columns:** source left, provisional translation right, keeping
today's dashed border, `opacity-80` and italic styling so an unsettled line still
reads as unsettled. When `live.translation` is absent the right cell is empty, not
missing — an empty grid cell keeps the columns aligned.

The left rule (`border-l-2`) marks the turn in both modes; it belongs to the row,
not the cell, so columns keep one rule per turn rather than two.

## Related Code Files

- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` — **the only call site**
  (`:121`); without this the prop defaults to `'stacked'` forever and every other step
  in this phase passes while the transcript never changes
- Modify: `apps/web/src/components/translate/translate-settings-panel.tsx` (add the control)
- Create: `apps/web/src/components/translate/conversation-transcript.spec.tsx`

## Implementation Steps

1. Add the `layout` prop, defaulting to `'stacked'` so any other caller is unaffected.
   1b. Pass `layout={settings.transcriptLayout}` from `cascade-panel.tsx:121`. Phase 2
   step 4 already gives that component a `settings` prop, so this is one line — but
   unlisted work is unbuilt work, which is why it is its own step.
2. Stacked branch: unchanged from today.
3. Columns branch: each `<li>` becomes `grid grid-cols-1 sm:grid-cols-2 gap-x-6
gap-y-1.5`, keeping `border-l-2 pl-4` on the `li`. Source in cell one, translation
   in cell two.
4. Apply the same treatment to the live-turns list, preserving the unfinished styling.
5. Add a `SegmentedControl` row to the settings panel — two options with
   `lucide-react` `Rows3` / `Columns2` icons plus text labels (icon-only would fail
   the label rule the other controls follow). No new primitive needed.
6. Empty state is layout-independent — leave it alone.
7. Spec: both layouts render both texts; columns collapses at the `sm` breakpoint
   class level; a live turn with no translation still renders; the choice persists.

## Success Criteria

- [x] The transcript on `/translate` actually changes layout — asserted at the page
      level, not only in the component spec
- [x] Toggle switches the transcript between stacked and two-column
- [x] Choice survives reload
- [x] Two-column collapses to stacked below `sm`, via CSS not JS
- [x] Translation keeps `text-translation` primacy in both modes
- [x] Live turns render correctly in both modes, including with no translation yet
- [x] `pnpm typecheck` + `pnpm lint` + `pnpm test` green

## Risk Assessment

- **Long Vietnamese source vs short English translation makes columns ragged.**
  Signal: visual review at real transcript length. Response: `items-start` and accept
  it — equalising heights would mean truncation, which loses content.
- **A JS-driven breakpoint would flicker or mismatch on hydration.** Signal: console
  hydration warning. Response: the plan specifies CSS-only collapse; do not
  reintroduce `window.matchMedia` here.
- **`max-w-2xl` may be too narrow for two readable columns.** Signal: columns feel
  cramped on desktop. Response: this is the moment to consider `AppShell` gaining a
  wider measure variant for this route — a shell change, so raise it rather than
  hardcoding a width in the transcript.
