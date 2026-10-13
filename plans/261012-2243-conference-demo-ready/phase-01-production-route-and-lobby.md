# Phase 1 — Production `/conference` route + lobby + `useConference` hook

**Goal:** a real route a user can open, name themselves, pick a source language, preview their
camera, and join a room — reusing the PoC's proven signaling by extracting it into a hook. No
visual polish yet (that's Phase 2); parity with the PoC's media exchange is the bar.

## Context

The PoC (`apps/web/app/(app)/conference-poc/page.tsx`) does everything in one 750-line client
component with inline styles. Phase 1 lifts the **non-visual** half (WebSocket signaling,
mediasoup Device/transport lifecycle, peer/stream state, translation wiring) into a reusable hook
so Phases 2–3 can build UI and fix translation against a stable surface.

## Files this phase owns

- `apps/web/src/hooks/use-conference.ts` (new) — the extracted hook.
- `apps/web/app/(app)/conference/page.tsx` (new) — lobby (create/join + device preview).
- `apps/web/app/(app)/conference/[roomId]/page.tsx` (new) — in-call screen **shell** that calls
  `useConference` and renders a minimal grid (full UI in Phase 2).
- `packages/i18n/src/**` (edit) — add the `conference.*` string keys used by the lobby (en + vi).

Do NOT touch `conference-poc/page.tsx` (benchmark client) or any `apps/api` file in this phase.

## Steps

1. **Read first:** `apps/web/AGENTS.md` → the routing/`use client` guide under
   `node_modules/next/dist/docs/`; an existing `(app)` route (e.g. `app/(app)/translate/`) for the
   project's layout, auth-session, and i18n conventions.
2. **Extract `useConference(roomId, { displayName, sourceLanguage })`.** Move verbatim from the
   PoC: `send`/`request`/`waitForEvent`, `wireSendTransport`/`wireRecvTransport`/`consumeTrack`,
   `onTrack`, the join sequence, and the `ws.message` handler for
   `conference.new.producer` / `conference.peer.joined` / `conference.peer.left` /
   `conference.translation.subtitle` / `conference.translation.audio`.
   Return a typed surface: `{ status, localStream, peers: Map<socketId, {displayName, stream,
muted, videoEnabled, subtitle}>, mySocketId, join(), leave(), toggleMute(), toggleVideo() }`.
   Leave `toggleMute/toggleVideo` as stubs that send the existing
   `conference.participant.mute`/`video` events (wired to UI in Phase 2).
   Leave the translation `direction`/audio-sink **as-is** for now — Phase 3 fixes them. Keep the
   `[T1]`–`[T4]` console markers.
3. **Lobby `page.tsx`.** A form (room id — prefilled with a generated id for "create", editable
   for "join"; display name; source-language select vi/en) + a muted local-camera preview via
   `getUserMedia`. On submit, route to `/conference/<roomId>` carrying name + language (query or
   client state). Use `@chatofy/ui/react` inputs/button and `@chatofy/i18n` strings.
4. **In-call shell `[roomId]/page.tsx`.** Call `useConference`, auto-join on mount, render a bare
   grid of `peers` + local tile + a Leave button. This is deliberately ugly; Phase 2 replaces the
   body. It exists so Phase 1 is independently verifiable.
5. **i18n.** Add keys (`conference.lobby.title`, `.create`, `.join`, `.yourName`,
   `.sourceLanguage`, `.start`, `conference.call.leave`, `.waiting`, …) in en + vi.

## Verification

- `pnpm --filter web typecheck` and `pnpm --filter web build` green.
- `pnpm dev:all`, open `/conference` in two browser profiles, create+join the same room: both
  see each other's video and audio (parity with `/conference-poc`), and the `[T1]`–`[T4]` markers
  still fire — proving the hook extraction lost nothing.
- Lobby renders with design tokens (no inline-style dump), strings resolve in both locales.

## Acceptance criteria

- `/conference` lobby + `/conference/[roomId]` exist and join a real room through `useConference`.
- Two tabs exchange A/V with no regression vs the PoC.
- `/conference-poc` untouched and still works.

## Risk / rollback

Pure addition under `conference/` + `hooks/` + new i18n keys. Rollback = delete the three new
files and revert the i18n additions.
