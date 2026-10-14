# Plan: Conference on Mobile (React Native)

Bring the conference feature to the Expo/React Native app (`apps/mobile`) at **full parity with
web** — video call, realtime translation (subtitles + translated TTS audio), and in-meeting chat
with per-recipient translation — reusing the backend and shared contracts the web demo already
proved.

- **Outcome:** a mobile user joins the same room as a web user, sees two-way video, hears
  translated audio, reads live subtitles and a transcript, picks a source language, and chats with
  per-recipient translation — all against the existing `apps/api` gateway, no server changes.
- **Base branch:** `video-conferencing` (continue here; currently 57 commits ahead of `main`).
- **Timestamp:** 261014-2230.
- **Supersedes:** the two deferred mobile phases in `plans/261012-2243-conference-demo-ready/`
  (`phase-06-mobile-call.md`, `phase-07-mobile-translation.md`) — this plan is their revived,
  re-scoped form that also adds chat parity.

## Architecture decision (accepted)

**Parallel native hook, not a shared-core extraction.** Build `useConferenceNative` that mirrors
the web hook's public `UseConferenceReturn` contract, reusing only the platform-neutral pieces that
already ship as packages (event Zod schemas in `@chatofy/types`, PCM codec utilities in
`@chatofy/realtime-client`). Rationale: the web `use-conference.ts` has mediasoup + Web Audio woven
through it with no abstraction seam, and it is a finished, demo-green hook; extracting a shared core
now means refactoring working code for a reuse benefit that only lands with a third consumer. A
parallel hook on the same contract is lower-risk and ships faster. Extraction stays a later option
if a third platform appears.

## Reuse map (what is shared vs. genuinely new)

| Concern                                                                    | Source on web                                                    | Mobile                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Signaling envelope `{event,data}`, request/reply                           | `use-conference.ts`                                              | Re-implement in hook (PoC already does raw WS)                                              |
| Room/peer state, subtitle keying by `(socketId,turnId)`, reconnect backoff | `use-conference.ts`                                              | Re-implement in `useConferenceNative` (port logic)                                          |
| Event types (subtitle / audio / chat)                                      | `@chatofy/types` events                                          | **Import as-is**                                                                            |
| PCM16 ↔ base64, RMS, downsample                                            | `@chatofy/realtime-client` (`pcm16ToBase64`, `base64ToPcm16`, …) | **Import as-is** (pure, no browser API)                                                     |
| `PcmPlaybackQueue`, `MicrophoneGraph`, `CapturePump`                       | `@chatofy/realtime-client`                                       | **Browser-only — replace** with native audio                                                |
| mediasoup Device/transports                                                | `mediasoup-client` (web)                                         | `mediasoup-client` (already in mobile deps) + `react-native-webrtc` globals (PoC proves it) |
| getUserMedia                                                               | `navigator.mediaDevices`                                         | `react-native-webrtc` `mediaDevices` (PoC proves it)                                        |
| Chat per-recipient translation                                             | `conference.gateway.ts` (server)                                 | **Server unchanged**; client just sends `conference.chat`, renders `ConferenceChatMessage`  |
| UI components                                                              | web DOM components                                               | **New native** components on `@chatofy/ui` tokens                                           |

## What the PoC already proves (do not rebuild)

`apps/mobile/app/(app)/conference-poc.tsx` (277 lines) + `conference-poc-call-view.tsx` already do:
`registerGlobals()`, raw WS signaling to `/ws/conference`, mediasoup `Device` + send/recv
transports with DTLS connect, `getUserMedia({video,audio})`, produce/consume tracks, `RTCView`
rendering, and mic/cam/leave. It has **no translation and no chat**, **3 known typecheck errors**
at the mediasoup-vs-react-native-webrtc `MediaStreamTrack` boundary, and auth via
`EXPO_PUBLIC_BENCH_*` env + direct `POST /auth/login`. Phase 1 lifts this working media logic into
the hook/routes and fixes those two debts.

## Phases & sequencing

| Phase | Scope                                                                                                                   | Touches hook/call-view? | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ |
| 1     | Native conference core (video parity): `useConferenceNative` + routes + native call UI + typecheck/auth fix + reconnect | yes (creates them)      | L      |
| 2     | Audio adapters: RN PCM16 capture → `/ws/translate`, ordered PCM16 playback sink                                         | yes (hook wiring)       | L      |
| 3     | Translation UX: subtitle overlay, transcript sheet, language picker, `translating…` indicator                           | yes (call view)         | M      |
| 4     | In-meeting chat: native chat panel, `sendChat`, per-recipient rendered messages                                         | yes (hook + call view)  | M      |

**All four touch the hook and/or call view → run strictly sequentially 1 → 2 → 3 → 4.** No two
agents on `useConferenceNative` or the call view at once. Phase 1 is the foundation; 2 needs its
`localStream` + hook; 3 needs 2's audio + subtitle events; 4 needs 1's hook + WS (independent of
audio, but edits the same files, so it stays last).

## Constraints

- **Additive-only, PoCs intact.** Do not modify `apps/api` or web `conference/` routes. Keep
  `conference-poc.tsx` + `conference-poc-call-view.tsx` until Phase 1's route is verified, then the
  PoC may be removed in Phase 1's final step (optional).
- **Pin `react-native-webrtc@124.0.8`** (New-Architecture fix from #210 — do not bump). Keep
  `mediasoup-client@3.7.18`.
- **`useConferenceNative` return surface mirrors web `UseConferenceReturn`** and is additive-only
  thereafter (append fields, never rename/remove).
- **`@chatofy/ui` tokens only**, no hardcoded colors/strings; must pass `token-parity.spec.ts`.
  One primary action on the call screen = **Leave**; mic/cam are toggles/readouts.
- **i18n:** any new key lands in BOTH `packages/i18n/src/en.ts` and `vi.ts`, and
  `pnpm --filter @chatofy/i18n build` runs before mobile typecheck.
- **16 kHz PCM16-LE** is the wire format both `/ws/translate` and the TTS frames use — the RN audio
  lib must capture and play that, or the adapter must resample at its boundary.

## Risks

| Risk                                                                                     | Mitigation                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No RN PCM audio library present; wrong choice blocks translation                         | **Phase 2 step 1 is a bounded spike** evaluating `react-native-audio-api` vs `expo-av`/others for 16 kHz PCM16 capture **and** playback; surface the pick + any heavy native dep to the user before adding it (per deferred-plan Phase 7 note) |
| mediasoup `MediaStreamTrack` type mismatch (3 errors) breaks if track methods get called | Contain the cast/adapt at one adapter boundary in Phase 1; do not scatter `any` through the hook                                                                                                                                               |
| Two concurrent WebSockets (`/ws/conference` + `/ws/translate`) unreliable on RN          | Phase 2 verifies two-socket first; if flaky, fall back to multiplexing translate frames over the conference socket (document the decision)                                                                                                     |
| `/ws/conference` token validation unverified → unauth join                               | Phase 1 confirms the gateway validates the subprotocol token before relying on real auth; if it does not, note it as an API follow-up (out of scope here)                                                                                      |
| New-Arch / Expo dev-client build fragility                                               | Keep pins; build on a real device/emulator early in Phase 1, not at the end                                                                                                                                                                    |
| Active screen draws a second accent → token/design drift                                 | Leave is the single primary; everything else ghost/readout; keep tokens only                                                                                                                                                                   |

## Verification per phase

| Phase | Pass check                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | A device joins a room created from web; two-way video via `RTCView`; mic/cam/leave propagate to a web peer; reconnect shows a state and recovers; `tsc --noEmit` clean (0 errors, the 3 are fixed); teardown releases the camera |
| 2     | Speaking on mobile produces a transcript on a web peer; translated TTS audio plays **in order** on the mobile listener with no overlap; chosen audio lib + any native dep confirmed with the user                                |
| 3     | Subtitles render on the speaking tile and clear on final/timeout; transcript sheet accumulates the call's turns; language picker drives the real `sourceLanguage`/direction; `token-parity.spec.ts` green                        |
| 4     | Mobile→web and web→mobile chat each arrive already translated into the recipient's language; own messages echo; list + input render on tokens                                                                                    |

Cross-platform runtime smoke (mobile↔web room, audio audible, vi↔en both directions) is **manual
on the live stack** — documented per phase, not gated by automated tests.

## Rollback

Every phase is additive under `apps/mobile/app/(app)/conference/`, `apps/mobile/src/conference/`,
and `apps/mobile/src/components/conference/`. Revert order is reverse-sequential: dropping Phase 4
leaves translation video intact; dropping Phase 3 leaves audio-only translation; dropping Phase 2
leaves a video-only call; dropping Phase 1 restores exactly today's PoC. No server or web changes to
roll back.

## Unresolved questions

1. **RN audio library** — resolved by the Phase 2 spike; the user approves the pick before any
   heavy native dependency is added.
2. **Two sockets vs. multiplex** for `/ws/translate` on RN — decided empirically in Phase 2.
3. **`/ws/conference` auth** — Phase 1 confirms whether the gateway validates the token; a gap
   becomes a separate `apps/api` task, not part of this mobile plan.
