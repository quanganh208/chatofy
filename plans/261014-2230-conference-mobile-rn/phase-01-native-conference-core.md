# Phase 1 — Native conference core + call UI (video parity)

**Goal:** a real Expo Router conference (lobby + call view) backed by a `useConferenceNative` hook
that mirrors the web `UseConferenceReturn` contract, bringing mobile to **video parity** with web —
two-way video, mic/cam/leave, call-lifecycle state machine, reconnect, permissions, teardown. This
lifts the proven PoC media logic into production shape and pays off its two debts (3 typecheck
errors, env-hack auth).

## Context

The PoC (`apps/mobile/app/(app)/conference-poc.tsx` + `conference-poc-call-view.tsx`) already does
raw WS signaling to `/ws/conference`, mediasoup `Device` + send/recv transports with DTLS,
`getUserMedia` via `react-native-webrtc`, produce/consume, `RTCView` rendering, and mic/cam/leave —
but imperatively, with refs, no translation/chat, 3 typecheck errors, and bench-env auth. The web
contract to mirror is `UseConferenceReturn` in `apps/web/src/hooks/use-conference.ts` (status,
`errorReason`, `reconnectAttempt`/`reconnectCap`, `peers` Map, `mySocketId`, `localMuted`,
`localVideoEnabled`, `localStream`, `localTranslating`, `audioBlocked`, `messages`, `join`, `leave`,
`toggleMute`, `toggleVideo`, `resumeAudio`, `sendChat`). This phase implements the **non-translation,
non-chat subset**; `localTranslating`/`audioBlocked`/`messages`/`sendChat`/`resumeAudio` are
declared in the contract but may be inert stubs until Phases 2–4.

## Files this phase owns

- `apps/mobile/src/conference/use-conference-native.ts` — the hook (signaling, mediasoup via
  `react-native-webrtc` globals, room/peer state, reconnect backoff).
- `apps/mobile/src/conference/native-media-adapter.ts` — the single boundary that adapts
  `react-native-webrtc` tracks to mediasoup-client's DOM-typed expectations (contains the cast that
  fixes the 3 errors; no `any` leaks past it).
- `apps/mobile/app/(app)/conference/index.tsx` — lobby (create/join + local preview + displayName).
- `apps/mobile/app/(app)/conference/[roomId].tsx` — call view.
- `apps/mobile/src/components/conference/video-grid.tsx`,
  `participant-tile.tsx` (RTCView), `call-control-bar.tsx`, `participant-sheet.tsx` — native
  components on `@chatofy/ui` tokens.
- `apps/mobile/app/(app)/_layout.tsx` — add the conference route to navigation.
- i18n keys for the lobby + call screen in `packages/i18n/src/{en,vi}.ts`.

Do NOT modify `apps/api` or web `conference/`. Keep the PoC files until step 7.

## Steps

1. **Read first:** the two PoC files (working RN media logic, RTCView, RN-WebRTC quirks, the
   subprotocol-token WS open); sibling `(app)` screens for Expo Router + token/provider conventions
   (`apps/mobile/src/providers/*`, `src/ui/theme.ts`); web `use-conference.ts` for the exact return
   contract and the reconnect/peer-state logic to port; `packages/types/src/events/` conference
   event schemas.
2. Build `native-media-adapter.ts` isolating the mediasoup↔react-native-webrtc track boundary.
   → verify: `tsc --noEmit` shows the 3 track-type errors resolved with the cast localized here.
3. Build `use-conference-native.ts`: port signaling (request/reply, waitForEvent), Device +
   transports from the PoC, room/peer-state reducer, `toggleMute`/`toggleVideo`, and the reconnect
   backoff (attempt cap + intentional-leave guard) ported from the web hook. Expose the full
   contract with translation/chat fields stubbed inert.
   → verify: a device joins a web-created room; media flows both ways; a simulated socket close
   drives `reconnecting` → recovers.
4. Build the native components (one primary action = Leave; mic/cam toggles; RTCView tiles).
   → verify: remote video shows on device/emulator; `token-parity.spec.ts` green.
5. Wire lobby + `[roomId]` with the state machine (idle/connecting/waiting/in-call/reconnecting/
   error) and **explicit RN permission prompts** (Android `PermissionsAndroid`, iOS Info.plist
   usage strings + implicit request). Degrade to audio-only on camera denial, matching web.
   → verify: create navigates to `[roomId]`; mic/cam/leave propagate to a web peer; permission
   denial renders a clear state, no crash.
6. **Auth:** confirm whether `apps/api` validates the subprotocol token on `/ws/conference`
   (read the gateway). Replace the PoC's `EXPO_PUBLIC_BENCH_*` + direct `POST /auth/login` with the
   app's real token source if one exists; if the gateway does not validate, record it as an API
   follow-up (out of scope) and keep the token-in-subprotocol path.
   → verify: an authed session joins; the bench-env hack is gone from the production route.
7. Teardown on unmount/leave (stop tracks, close both socket refs) per
   `.claude/rules/process-management.md`. Optionally delete the PoC files once the route is proven.
   → verify: leaving releases the camera (indicator off); no orphaned sockets.

## Verification

- Mobile user + web user share a room with two-way audio/video; mute/cam/leave propagate across
  platforms.
- `tsc --noEmit` clean (0 errors — the 3 are fixed); `token-parity.spec.ts` green.
- Reconnect shows a visible state and recovers; dead-ends to lobby only after the cap.
- Permission-denied + error states render clearly.

## Risk / rollback

- Contain the mediasoup track mismatch at `native-media-adapter.ts` only.
- Build on a real device/emulator early (New-Arch/Expo fragility is why #210 took two fixes); keep
  `react-native-webrtc@124.0.8` pinned.
- Rollback: additive under `conference/` + `src/conference/` + `src/components/conference/`; PoCs
  stay until step 7, so reverting restores today's behavior.
