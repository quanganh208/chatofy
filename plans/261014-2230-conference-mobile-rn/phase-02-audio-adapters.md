# Phase 2 — Native audio capture + playback adapters

**Goal:** the genuinely new native work — capture 16 kHz PCM16 from the mic and stream it to
`/ws/translate`, and play incoming TTS PCM16 frames back **in order, per speaker**. This is the
plumbing translation rides on; Phase 3 adds the UI.

## Context

On web, capture is `AudioContext` + `ScriptProcessor` (float32→int16) feeding `/ws/translate`
(`wireTranslate` in `use-conference.ts`), and playback is `TranslationAudioSink` using
`PcmPlaybackQueue` on the Web Audio clock. **None of that runs on RN.** But two things are reusable:
the **PCM codec utilities** in `@chatofy/realtime-client` (`pcm16ToBase64`, `base64ToPcm16`,
`pcm16Rms`, `downsampleToPcm16` — pure, no browser API) and the **resequencing logic** of
`TranslationAudioSink` (buffer by `sequence`, drain the contiguous prefix). `apps/mobile` ships
`src/audio/audio-recorder.interface.ts` and `audio-player.interface.ts` (contracts only, no
implementation) and **no PCM audio library** — choosing one is step 1.

The wire contracts are fixed in `packages/types`: `ConferenceTranslationSubtitle`,
`ConferenceTranslationAudio` (base64 PCM16 + `sequence`), `ConferenceTranslationBroadcast`.

## Files this phase owns

- `apps/mobile/src/conference/native-audio-capture.ts` — implements `audio-recorder.interface.ts`;
  PCM16 frames from the mic into the translate bridge.
- `apps/mobile/src/conference/native-audio-playback.ts` — implements `audio-player.interface.ts`;
  ordered PCM16 playback, one logical sink per speaker, reusing the resequence logic.
- `apps/mobile/src/conference/translate-bridge-native.ts` — opens `/ws/translate` (or multiplexes
  over the conference socket), float/int conversion via realtime-client utils, broadcasts subtitle
  - audio frames to `/ws/conference`, mirroring web `wireTranslate`.
- Hook wiring in `use-conference-native.ts`: start capture on join, feed playback from incoming
  `ConferenceTranslationAudio`, drive `localTranslating` during the speak→subtitle gap.

## Library choice (step 1 — user-approved)

**`react-native-audio-api` 0.13.6** (Software Mansion). A Web Audio API
implementation for RN: New-Arch compatible, ships an Expo config plugin, and
does both 16 kHz PCM16 **capture** (`AudioRecorder` data-callback mode, float32
channel data) and low-latency **playback** of streamed frames (`AudioContext` —
lets `PcmPlaybackQueue` from `@chatofy/realtime-client` be reused unchanged).
User approved before adding; requires a dev-client native rebuild before runtime.

## Steps

1. **Spike (bounded) — pick the RN audio library.** Evaluate `react-native-audio-api` vs `expo-av`
   vs any already-transitive option for **both** 16 kHz PCM16 **capture** and low-latency
   **playback** of streamed frames. Produce a one-paragraph verdict with the dep weight and native
   build impact. **Surface the pick to the user and get approval before adding a heavy native
   dependency** (deferred-plan Phase 7 flagged this explicitly).
   → verify: user-approved library choice recorded in this phase file.
2. Implement `native-audio-capture.ts` against the chosen lib; convert to PCM16 with
   `downsampleToPcm16`/`pcm16ToBase64` from realtime-client; feed `translate-bridge-native.ts`.
   → verify: speaking on mobile produces a transcript event on a web peer.
3. Implement `native-audio-playback.ts`: decode with `base64ToPcm16`, buffer by `sequence`, drain
   contiguous (port `TranslationAudioSink.drainSink` logic), one sink per `speakerSocketId`.
   → verify: translated TTS plays in order on the mobile listener, no overlap or gaps.
4. Decide `/ws/translate` as a **second socket** vs **multiplex** over `/ws/conference`: try two
   sockets first; if RN drops or stalls one, multiplex and document the decision in this file.
   → verify: both sockets (or the multiplexed path) stay alive for a 3-minute call.
5. Wire into the hook: capture starts on join and stops on leave/unmount; `localTranslating` turns
   on when the speaker's audio starts and clears on the final subtitle or a timeout.
   → verify: no orphaned audio session after leave; indicator never sticks on.

## Verification

- Mobile speaker → web listener shows a transcript and plays translated audio; web speaker →
  mobile listener likewise, **in order**.
- Audio session is released on leave (per `.claude/rules/process-management.md`); no background mic.
- Chosen library + any native dependency confirmed with the user.

## Risk / rollback

- If no RN lib cleanly does 16 kHz PCM16 both ways, step 1 surfaces it before code is written —
  raise alternatives (resample at the adapter, different sample rate negotiated with the bridge)
  rather than forcing a bad dep.
- Capture/playback is the real new surface; budget extra time — the PoC never wired translation, so
  the web path is the only reference.
- Rollback: additive; removing the capture/playback wiring from the hook leaves Phase 1's
  video-only call fully working.
