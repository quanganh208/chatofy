# Phase 1 — Native conference core + call UI (video parity)

Plan: `plans/261014-2230-conference-mobile-rn/` · Phase: `phase-01-native-conference-core.md`
Status: DONE

## Outcome

Mobile now has a real Expo Router conference (lobby + call view) backed by
`useConferenceNative`, which mirrors the web `UseConferenceReturn` contract. The video
subset is implemented end to end: call-lifecycle state machine, local media, remote
peer map, mic/cam/leave, bounded reconnect (cap 3, backoff 1s/2s/4s), RN permissions,
and full teardown. The two debts are paid: the 3 PoC typecheck errors are fixed via a
single localized adapter, and the bench-env auth hack is isolated out of the route into
one swappable function. Translation/chat fields exist on the return as inert stubs for
Phases 2–4.

## Files created

- `apps/mobile/src/conference/native-media-adapter.ts` — the single mediasoup ↔
  react-native-webrtc track-type boundary. `toMediasoupTrack` / `toNativeTrack` contain
  the only casts; no `any` leaks past this module.
- `apps/mobile/src/conference/use-conference-native.ts` — the hook. Full
  `UseConferenceReturn` surface; signaling + Device/transports lifted from the PoC;
  reconnect loop + peer-state reducer ported from the web hook. Inbound events handled:
  `conference.new.producer`, `conference.peer.joined`, `conference.peer.left`,
  `conference.participant.state` (all confirmed emitted by the gateway).
- `apps/mobile/src/conference/conference-token.ts` — isolated token source (see Known
  limitations).
- `apps/mobile/src/components/conference/participant-tile.tsx` — RTCView tile + readouts.
- `apps/mobile/src/components/conference/video-grid.tsx` — local-first tile grid.
- `apps/mobile/src/components/conference/call-control-bar.tsx` — mic/cam ghost toggles +
  participants + the single accent action, Leave.
- `apps/mobile/src/components/conference/participant-sheet.tsx` — roster modal.
- `apps/mobile/app/(app)/conference/index.tsx` — lobby (room + name + local preview + Start).
- `apps/mobile/app/(app)/conference/[roomId].tsx` — call view consuming the hook; renders
  connecting/waiting/in-call/reconnecting + error/disconnected dead-ends.
- `apps/mobile/app/(app)/conference/_layout.tsx` — Stack nesting lobby + call under one tab
  (required so `[roomId]` pushes over the lobby rather than becoming a sibling tab).

## Files modified

- `apps/mobile/app/(app)/_layout.tsx` — registered the `conference` tab (PoC tab kept).
- `apps/mobile/app/(app)/conference-poc.tsx` — applied the adapter at the 3 error sites
  (lines 109, 155, 156) to fix the known typecheck errors. PoC otherwise left intact.
- `apps/mobile/package.json` — added `@chatofy/i18n` workspace dependency.
- `packages/i18n/src/en.ts` + `vi.ts` — added the `mobile.conference.*` namespace (31 keys,
  matching in both locales). A separate namespace from `web.conference.*` because the
  permission hint and "reload" copy differ on a device vs a browser.

## Verification (each command run, real exit status)

1. `pnpm --filter @chatofy/i18n build` → **exit 0** (ESM+CJS+DTS built).
2. i18n parity: `pnpm --filter @chatofy/i18n exec tsc -b --noEmit` → **exit 0** (vi.ts carries
   every new key; `Messages` type is the parity gate).
3. Mobile typecheck (package name is `mobile`, not `@chatofy/mobile`):
   `pnpm --filter mobile exec tsc --noEmit` → **exit 0 — 0 errors**, including the 3
   previously-known PoC errors (confirmed: they appeared before the adapter fix, gone after).
4. Token-parity spec: `pnpm --filter web exec vitest run src/design/token-parity.spec.ts` →
   **exit 0 — 179/179 passed**.
5. `pnpm --filter mobile run lint` → **exit 0 — 0 errors, 0 warnings**.
6. Hardcoded-hex scan of all new files → none; every colour via `@chatofy/ui` tokens, every
   string via `@chatofy/i18n`.

Runtime device/emulator verification (two-way video, cross-platform mute/cam/leave, live
reconnect) was NOT performed — no emulator/device in this environment. Static gates 1–5 are
the gate per the brief; runtime smoke is manual on the live stack.

## Contract / behavior notes

- `/ws/conference` auth is REAL and REQUIRED: the gateway validates the subprotocol token at
  the HTTP upgrade (`apps/api/.../translate/ws-auth.ts` → `createVerifyClient` →
  `auth.verifyToken`). So the token cannot be skipped; step 6's "does the gateway validate?"
  resolves to **yes**.
- `UseConferenceReturn` is additive-only vs web: same field names/types; the Phase 2–4 fields
  (`audioBlocked`, `localTranslating`, `resumeAudio`, `messages`, `sendChat`) are inert stubs.
- Teardown: `leave()` and the unmount cleanup both close the socket and stop all local + peer
  tracks (camera released); the lobby preview stream is stopped before navigating to the call.

## Known limitations

- **Auth token source (isolated, demo-grade).** The mobile `AuthClient` is still a throwing
  stub, so there is no real signed-in session. `conference-token.ts` logs in with
  `EXPO_PUBLIC_BENCH_*` env creds (already present in `apps/mobile/.env`) and returns the
  access token. This is the only place the bench dependency lives — swapping it for a real
  `AuthClient` is a one-function change, out of Phase 1 scope. Not an API follow-up (the
  gateway validation is correct); it is a mobile-auth follow-up.
- **i18n locale is fixed to English.** Mobile has no locale infrastructure and adding
  `expo-localization` is a native dependency needing user approval. Both locales ship the
  keys; the screens call `createTranslator(en)`. Wiring device-locale selection (and a vi
  path) is a small follow-up.
- **PoC files retained.** `conference-poc.tsx` / `conference-poc-call-view.tsx` left in place
  per the brief (optional deletion deferred). The PoC was minimally edited only to apply the
  adapter and clear its 3 errors.

## Unresolved questions

1. Should the PoC files and the `conference-poc` tab be removed now that the real route is in,
   or kept until runtime-verified on a device? (Brief said keep; flagging as the intended
   final-step follow-up.)
2. Mobile i18n: approve `expo-localization` (or an alternative) to enable the vi path, or keep
   English-only for the demo?
