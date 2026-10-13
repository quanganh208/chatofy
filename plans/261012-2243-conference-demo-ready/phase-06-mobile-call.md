# Phase 6 — Mobile lobby + call view (React Native)

**Goal:** bring the conference to the mobile app at parity with the web demo —
an Expo Router lobby and an in-call view with video grid, local preview, and a
control bar (mic/cam/leave) — reusing the signaling core proven on web. Post-demo
scope; the web demo (Phases 1–5) ships first.

## Context

Mobile runs React Native + `react-native-webrtc@124.0.8` on the New Architecture
(fixed in #210). The PoC lives at `apps/mobile/app/(app)/conference-poc.tsx` +
`conference-poc-call-view.tsx`. Mobile consumes raw tokens from `packages/ui`
(no `@chatofy/ui/react` DOM components) and builds native components.

The reuse target is Phase 1's `useConference` hook. Its media calls
(`getUserMedia`, mediasoup Device, send/recv transports) are browser-specific;
its signaling + room-state half is not. **Extract the platform-neutral core
only now** — with mobile as the real second consumer — rather than speculatively
in Phase 1. If the web hook already cleanly separates signaling/state from the
media calls, lift that core into a shared module (`packages/conference-core` or
a shared `src/` consumed by both); otherwise refactor the web hook first so the
media calls sit behind an injectable adapter, then supply a React Native adapter.

## Files this phase owns

- A shared signaling/state module (extracted from `use-conference.ts`), or a
  documented decision to keep two thin hooks over one shared core if extraction
  costs more than it saves.
- `apps/mobile/src/conference/native-media-adapter.ts` — react-native-webrtc
  Device/transports + `mediaDevices.getUserMedia`.
- `apps/mobile/src/conference/use-conference.ts` — RN binding on the shared core.
- `apps/mobile/app/(app)/conference/index.tsx` — lobby (create/join + preview).
- `apps/mobile/app/(app)/conference/[roomId].tsx` — call view.
- `apps/mobile/src/components/conference/` — native `VideoGrid`,
  `ParticipantTile` (RTCView), `CallControlBar`, `ParticipantSheet`.

Do NOT modify `apps/api` or the web `conference/` routes beyond the core
extraction. Keep both PoCs intact.

## Steps

1. **Read first:** `apps/mobile/app/(app)/conference-poc.tsx` +
   `conference-poc-call-view.tsx` (working RN media logic, RTCView usage,
   RN-WebRTC quirks); sibling `(app)` screens for Expo Router + token
   conventions; Phase 1's `use-conference.ts` to judge the extraction seam.
2. Extract the signaling/state core (or refactor the web hook to expose an
   injectable media adapter), keeping the web demo green. → verify: web still
   joins two tabs with no regression.
3. Build `native-media-adapter.ts` from the PoC's react-native-webrtc calls.
   → verify: a device joins a room created from web; media flows both ways.
4. Build the native components with `packages/ui` tokens (one primary action =
   Leave; mic/cam as toggles). → verify: RTCView shows remote video on a
   device/emulator.
5. Lobby + call view with the state machine (connecting/waiting/in-call/error)
   and RN permission prompts (camera/mic) handled explicitly.
   → verify: create navigates to `[roomId]`; mic/cam/leave propagate to a web
   peer.
6. Teardown on unmount/leave (stop tracks, close sockets) per
   `.claude/rules/process-management.md`. → verify: leaving releases the camera.

## Verification

- A mobile user and a web user share a room with two-way audio/video.
- Mute/camera/leave propagate across platforms.
- Uses `packages/ui` tokens; passes `token-parity.spec.ts`.
- Permission-denied and error states render clearly; no crash.

## Risk / rollback

- The 3 pre-existing mobile typecheck errors from #210 (mediasoup-client DOM
  `MediaStreamTrack` vs react-native-webrtc) should be contained at the adapter
  boundary (cast/adapt there), not carried into the shared core. Resolve them
  here.
- New Architecture / Expo build fragility (the reason #210 took two fixes):
  keep `react-native-webrtc@124.0.8` pinned; do not bump.
- Rollback: additive under `apps/mobile/.../conference/` + `src/conference/`;
  the core extraction is revertible per file. PoCs untouched.
