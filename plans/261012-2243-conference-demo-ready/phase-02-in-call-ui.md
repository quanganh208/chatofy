# Phase 2 — In-call UI: grid, control bar, roster, subtitle overlay

**Goal:** turn the Phase 1 shell into a screen that looks and behaves like a meeting: responsive
video grid, a control bar (mic/cam/leave), a participant roster, and a subtitle overlay — all on
`@chatofy/ui` tokens + `@chatofy/i18n`, passing the enforced design specs.

## Context

The gateway **already** supports mute/video/leave and broadcasts `conference.participant.state`
(`conference.gateway.ts:505–573`). Phase 1's hook exposes `toggleMute/toggleVideo/leave` and a
`peers` map with `muted`/`videoEnabled`. Phase 2 is almost entirely web components wiring that
surface — no new server events needed.

## Files this phase owns

- `apps/web/app/(app)/conference/[roomId]/page.tsx` (edit: replace shell body with composed UI).
- `apps/web/app/(app)/conference/[roomId]/components/video-grid.tsx` (new)
- `.../components/control-bar.tsx` (new)
- `.../components/participant-list.tsx` (new)
- `.../components/subtitle-overlay.tsx` (new)
- `apps/web/app/(app)/conference/[roomId]/utils/video-layout.ts` (new — grid columns per count)
- `apps/web/src/design/accent-budget-app.spec.tsx` (edit: register the `/conference` screen state)
- `packages/i18n/src/**` (edit: control-bar/roster strings, en + vi)

Must NOT change `useConference`'s public surface (Phase 3 depends on it) beyond additive,
backward-compatible fields. Do NOT touch `apps/api`.

## Steps

1. **Read first:** `docs/design-guidelines.md` and `.claude/rules/development-rules.md`
   (UI review § — the two enforced rules: ≤1 accent control + ≤2 elevated surfaces per
   screen-state) and the existing accent-budget spec to see how a screen state is registered.
2. **video-grid.tsx.** Responsive grid from `video-layout.ts` (1 → full, 2 → 2-up, 3–4 → 2×2,
   5–6 → 3×2). Each tile: `<video>` bound to the peer/local stream, name label, a
   camera-off placeholder when `videoEnabled === false`, a muted-mic glyph when `muted`, and the
   subtitle overlay slot. Local tile always muted (no echo).
3. **control-bar.tsx.** Mic toggle, camera toggle, Leave. Wire mic/cam to
   `toggleMute`/`toggleVideo` (which send the existing events) and reflect local state. **Leave
   is the single accent (primary) control** on this screen; mic/cam are ghost/outline toggles.
   Leave calls `leave()` then routes back to `/conference`.
4. **participant-list.tsx.** Roster from `peers` + self: name, mic/cam state glyphs, source
   language. Driven by `conference.peer.joined/left` and `conference.participant.state` (already
   in the hook's stream state). A region/list, not cards (design rule).
5. **subtitle-overlay.tsx.** Render the current subtitle for a tile from the hook's per-peer
   `subtitle`. Partial vs final styling (final solid, partial dimmed) — keep it a pure readout.
6. **Compose** in `[roomId]/page.tsx`: grid center, control bar bottom, roster as a collapsible
   side region. Loading/permission/empty states use tokens + i18n.
7. **Design spec.** Register `/conference` in `accent-budget-app.spec.tsx` for its screen-states
   (in-call, waiting) asserting exactly one accent control (Leave) and ≤2 elevated surfaces; run
   the contrast specs.

## Verification

- `pnpm --filter web typecheck` + `build` green; `pnpm --filter web test` (design specs:
  accent-budget-app + contrast-floors) green with the new screen registered.
- Two+ tabs: mic toggle in tab A shows a muted glyph on A's tile in tab B; camera off in A shows
  A's placeholder in B; Leave in A removes A's tile in B and returns A to the lobby.
- Grid reflows correctly at 1, 2, 4, and 6 tiles (resize + add tabs).

## Acceptance criteria

- Full in-call screen on design tokens + i18n; mic/cam/leave functional and reflected across
  peers; roster accurate; subtitles render per tile; design specs pass.

## Risk / rollback

Web-only. Rollback = revert `[roomId]/page.tsx` to the Phase 1 shell and delete the components +
the accent-budget spec addition.
