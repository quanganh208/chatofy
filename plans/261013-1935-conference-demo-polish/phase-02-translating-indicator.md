# Phase 2 — "Translating…" pending indicator (item B)

**Goal:** the ~6 s gap between speaking and the subtitle appearing should read as "working", not
"frozen". Show a pending indicator on the local tile from the moment the speaker's audio starts
flowing to `/ws/translate` until the final subtitle comes back (or a timeout).

## Context

In `use-conference.ts`, `wireTranslate` already marks `[T1]` (first audio frame sent) and `[T2]`
(target transcript received). That is exactly the window to surface: between the first audio frame
and the final subtitle for the current turn.

## Files owned

- `apps/web/src/hooks/use-conference.ts` (edit) — track `localTranslating: boolean`; set true at
  `[T1]` for a turn, clear on the final subtitle for that turn OR after a timeout; expose it.
- `apps/web/app/(app)/conference/[roomId]/components/video-grid.tsx` (edit) — render a small
  "translating…" badge on the LOCAL tile when `localTranslating`.
- `apps/web/app/(app)/conference/[roomId]/page.tsx` (edit) — pass `localTranslating` into the grid.
- `packages/i18n/src/en.ts` + `vi.ts` (edit) — the badge string.

## Steps

1. In the hook, add `localTranslating` state + a ref. In `wireTranslate`'s audio `onaudioprocess`,
   when a new turn's first frame is sent (the existing `seq === 0` / `[T1]` point), set
   `localTranslating = true`. On the `server.live.transcript` with the final/target channel for
   that turn, set it false. Add a safety timeout (e.g. 10 s) so it never sticks if no final
   arrives. Expose `localTranslating` on the return.
2. In `video-grid.tsx`, accept a `localTranslating` prop and render a subtle badge
   (spinner/pulse + "translating…") on the local tile only. Pure readout; no accent fill.
3. Thread the prop from the page. i18n (en + vi), then `pnpm --filter @chatofy/i18n build`.

## Verification

- `pnpm --filter web typecheck` + `build` + `test` green.
- Logic check: `localTranslating` goes true at the first-audio-frame point and clears on the final
  subtitle or the timeout — never permanently stuck.
- Manual (live): after you speak, the badge shows during the gap and disappears when your subtitle
  lands.

## Acceptance

Local tile shows an unobtrusive "translating…" state during the speech→subtitle gap that always
clears. Specs green.

## Risk / rollback

Additive hook field + one prop. Rollback = remove the state and the badge.
