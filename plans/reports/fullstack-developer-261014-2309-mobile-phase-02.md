# Phase 2 — Native audio capture + playback adapters

Status: DONE_WITH_CONCERNS
Date: 2026-10-15 (Asia/Bangkok)
Plan: plans/261014-2230-conference-mobile-rn/phase-02-audio-adapters.md

## Outcome

Realtime translation audio is wired into the mobile conference. On join the hook
opens a SECOND socket to `/ws/translate`, captures 16 kHz mono PCM16 from the
mic via `react-native-audio-api`, streams it with the exact `wireTranslate` wire,
rebroadcasts returned subtitle + TTS frames onto `/ws/conference` as
`conference.translation.broadcast`, and plays incoming TTS PCM16 in order per
speaker. `localTranslating` is now real; incoming subtitle is stored in peer
state keyed by `(speakerSocketId, turnId)` so Phase 3 only renders. All
capture/playback/socket resources release on leave, reconnect, and unmount.

Library (user-approved): **`react-native-audio-api` 0.13.6**. Choice recorded in
the phase file (step 1). **A dev-client native rebuild is required before any of
this runs on-device** — the Expo config plugin adds native modules; I cannot
rebuild here.

## Files

- CREATE `apps/mobile/src/conference/native-audio-playback.ts` — `NativeTranslationAudioSink`, per-speaker ordered sink.
- CREATE `apps/mobile/src/conference/native-audio-capture.ts` — `NativeAudioCapture` implements `AudioRecorder`; mic → 16 kHz PCM16.
- CREATE `apps/mobile/src/conference/translate-bridge-native.ts` — `startTranslateBridge`, the `wireTranslate` equivalent.
- MODIFY `apps/mobile/src/conference/use-conference-native.ts` — sink + bridge lifecycle, incoming subtitle/audio handling, `localTranslating` state, teardown on leave/reconnect/unmount.
- MODIFY `apps/mobile/app.json` — registered `react-native-audio-api` Expo plugin with `iosMicrophonePermission`.
- MODIFY `apps/mobile/package.json` — added `react-native-audio-api@^0.13.6` and `@chatofy/realtime-client@workspace:*` (the PCM utils + `PcmPlaybackQueue` live there; mobile did not depend on it before).

No i18n keys added — the new code logs to console only, no user-facing strings.
No `apps/api` or web files touched. Phase 1 public surface is additive-only.

## PcmPlaybackQueue: REUSED, not ported

`PcmPlaybackQueue` (packages/realtime-client/src/audio/pcm-playback-queue.ts)
uses only standard Web Audio API — `context.currentTime`, `createBuffer`,
`createBufferSource`, `source.start/stop/onended`, `connect`,
`context.destination`. `react-native-audio-api` implements that same surface, so
I imported `PcmPlaybackQueue` directly from `@chatofy/realtime-client` and fed it
react-native-audio-api's `AudioContext`. Only the per-speaker **resequencing**
policy from `TranslationAudioSink` was ported (buffer by `sequence`, drain the
contiguous prefix). The two RN-specific deltas vs the web sink: the
`AudioContext` source, and base64 decode via `base64ToPcm16` (RN has no reliable
`atob`) instead of the browser `atob` loop. The web sink's suspended/resume
autoplay dance is dropped — RN has no autoplay policy, so `audioBlocked` stays
false and `resumeAudio` is a documented no-op.

One typing seam: react-native-audio-api's `AudioContext` type is its own, so
`PcmPlaybackQueue`'s standard-Web-Audio constructor param is satisfied with a
single `as unknown as` cast at the point of construction. The runtime shape
matches; only the nominal TS types differ.

## Two sockets vs multiplex

Implemented as **two sockets** (second WS to `/ws/translate`), matching web
exactly. Whether RN reliably holds two concurrent WebSockets for a multi-minute
call is a runtime fact I cannot test here — flagged as a runtime-verification
item (plan step 4). If it drops/stalls one on-device, the fallback is to
multiplex `client.live.*` over `/ws/conference`; that would be a follow-up change
isolated to the bridge.

## #1 runtime risk — mic contention with react-native-webrtc

`react-native-webrtc` already holds the mic for the mediasoup audio track during
a call. This phase adds a SECOND mic consumer (react-native-audio-api's
`AudioRecorder`). Whether two consumers can open the device mic concurrently is
device/OS-dependent and **UNVERIFIED on hardware**. If the recorder cannot open
while webrtc holds the mic, capture must instead **tap the existing webrtc audio
track** rather than opening a second mic. The bridge start is wrapped in a
try/catch so a capture failure leaves the video call fully up — translation just
does not start. This is the single most important on-device verification item.

## sourceLang vs sourceLanguage wire discrepancy (flagged)

Web `wireTranslate` emits the subtitle field as **`sourceLanguage`**
(use-conference.ts line 390), but `ConferenceTranslationSubtitleSchema`
(packages/types) names the field **`sourceLang`**. The mobile bridge matches
WEB's actual wire (`sourceLanguage`) so web↔mobile interop holds, which means
mobile's outbound subtitle also does not match the zod schema's field name. This
is a pre-existing web/API/schema discrepancy — not introduced here — and belongs
to the API/web owners to reconcile. Mobile deliberately follows the wire, not the
schema, to interop.

## Verification (executed)

1. `pnpm --filter @chatofy/i18n build` — **SKIPPED**: no i18n keys introduced (console logs only).
2. `pnpm --filter mobile exec tsc --noEmit` — **exit 0, 0 errors**.
3. `pnpm --filter mobile run lint` (`expo lint`) — **exit 0**.
4. `react-native-audio-api@^0.13.6` present in `apps/mobile/package.json`; Expo plugin registered in `app.json` with `iosMicrophonePermission`. **Verified** via node read-back.

Side builds: `pnpm --filter @chatofy/realtime-client build` — exit 0 (its `dist/`
had to be built so mobile's tsc could resolve the newly-added workspace dep).

AudioRecorder API surface (`new AudioRecorder()` no-arg, `onAudioReady(options,
cb)`, `clearOnAudioReady()`, `start()`, `stop()`) and `AudioManager`
(`setAudioSessionOptions`, `requestRecordingPermissions`,
`setAudioSessionActivity`) confirmed against the v0.13 Software Mansion docs, not
recalled. `IOSOption` corrected to `allowBluetoothHFP` (tsc caught
`allowBluetooth`).

Runtime/device verification (mic contention, two-socket longevity, actual
mobile↔web translation playback) is **NOT possible here** — static checks 1–3 are
the gate and all pass.

## Unresolved questions

1. **Mic contention** (above) — can react-native-audio-api open the mic while
   react-native-webrtc holds it? If not, switch capture to a webrtc-track tap.
2. **Two concurrent WebSockets** on RN for a 3-minute call — holds, or multiplex?
3. **`downsampleToPcm16` on a near-1:1 ratio** — I request 16 kHz capture and
   downsample from the buffer's actual rate defensively. If the device honours
   16 kHz exactly, the ratio is 1:1 (pure quantise). Worth confirming the device
   actually delivers ~16 kHz rather than a resampled-up buffer that loses quality.
4. **`sourceLang`/`sourceLanguage`** schema reconciliation — API/web owners' call;
   mobile follows the wire for interop.
