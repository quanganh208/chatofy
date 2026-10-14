# Phase 3 — Active-speaker ring + subtitle styling (item C)

**Goal:** make it obvious who is speaking and make subtitles easy to read from a distance —
components only, no hook change. Purely visual; the design spec must stay green.

## Context

A peer "is speaking / has a live translation" is already observable: a tile has an active
`subtitle` (set by the hook while a translation is in flight for that peer) — use that as the
active-speaker signal without any new hook state. The local tile's active signal is Phase 2's
`localTranslating` (if Phase 2 landed; otherwise skip the local ring).

## Files owned

- `apps/web/app/(app)/conference/[roomId]/components/video-grid.tsx` (edit) — apply a highlight
  ring to a tile whose `subtitle` is active (and the local tile when translating).
- `apps/web/app/(app)/conference/[roomId]/components/subtitle-overlay.tsx` (edit) — larger,
  higher-contrast subtitle text; keep the final-solid / partial-dimmed distinction.
- `apps/web/src/design/accent-budget-app.spec.tsx` (edit ONLY if a new screen state needs
  registering; otherwise leave it and just keep it green).

## Steps

1. In `video-grid.tsx`, add a ring/outline (e.g. `ring-2 ring-<neutral-or-ring-token>`) to a tile
   when its `subtitle` is truthy. Use a NON-accent token — not `bg-primary`/accent fill — so the
   accent budget is untouched (Leave stays the one accent control).
2. In `subtitle-overlay.tsx`, bump the subtitle to a larger readable size with a stronger scrim
   for contrast; preserve the `isFinal` solid vs partial-dimmed treatment. Respect the contrast
   floors (the token specs read tokens; verify the chosen foreground/scrim meets the floor).
3. Re-run the design specs; if a new visual state changed what the accent-budget spec sees,
   update its rows so it stays an accurate, green gate.

## Verification

- `pnpm --filter web typecheck` + `build` + `test` green — specifically `accent-budget-app` and
  the contrast-floor specs.
- Visual check (live): the speaking tile is clearly ringed; subtitles are legible across the room.

## Acceptance

Active speaker visibly highlighted and subtitles clearly legible, with the accent-budget and
contrast specs still green.

## Risk / rollback

Components-only, additive classes. Rollback = remove the ring class and revert the subtitle
sizing. **Does not touch `use-conference.ts`** — safe to run in parallel with any one hook phase.
