# Phase 7 — Mobile translation UX (React Native)

**Goal:** bring realtime translation to the mobile call view at parity with web
Phase 3 — subtitle overlay on the speaking tile, a transcript sheet, ordered
translated-audio playback, and the source-language picker. Post-demo scope.

## Context

Phase 3 already fixed the translation logic (bidirectional direction, ordered
audio queue, `turnId` partial/final handling) in the web hook. If Phase 6
extracted a shared signaling/state core, that fixed logic is reused directly and
only the platform-specific audio capture + playback differ. On web these ride
Web Audio; mobile needs an RN equivalent for both the `/ws/translate` PCM16
capture (speaker side) and the TTS PCM16 playback (listener side).

Reuse `@chatofy/realtime-client`'s ordered playback (README §realtime-client) if
it runs on RN; otherwise implement the RN audio sink against the same contract
Phase 3 used.

## Files this phase owns

- `apps/mobile/src/conference/native-audio-capture.ts` — RN PCM16 capture into
  the translate bridge.
- `apps/mobile/src/conference/native-audio-playback.ts` — ordered PCM16
  playback for incoming TTS frames.
- `apps/mobile/src/components/conference/subtitle-overlay.tsx` (native).
- `apps/mobile/src/components/conference/transcript-sheet.tsx` (native).
- `apps/mobile/src/components/conference/language-picker.tsx` (native).
- Changes to the Phase 6 call view + lobby to mount these.

## Steps

1. **Read first:** web Phase 3 result (the fixed `direction`/audio-queue logic
   and subtitle `isFinal`/`turnId` semantics); `apps/mobile/package.json` for an
   RN audio lib already present (reuse before adding one);
   `packages/types/src/events/conference-translation-events.ts`.
2. Implement `native-audio-capture.ts` feeding the translate bridge.
   → verify: speaking on mobile produces a transcript on a web peer.
3. Implement `native-audio-playback.ts` (ordered, single sink).
   → verify: translated audio plays in order on the mobile listener, no overlap.
4. Build the native overlay, transcript sheet, and language picker with tokens.
   → verify: captions render on the tile; transcript accumulates.
5. Mount in the call view; wire the picker to the join `sourceLanguage` + bridge
   direction. → verify: cross-platform subtitle + audio both directions (vi↔en).

## Verification

- Mobile speaker → web listener and web speaker → mobile listener both show
  subtitles and play translated audio in order.
- Transcript sheet holds the whole call's turns; overlay shows the latest.
- Language picker drives the real direction; tokens only, no hardcoded strings.

## Risk / rollback

- RN audio capture/playback is the genuinely new work (web got it from Web
  Audio). If no suitable RN lib exists, this phase surfaces it — raise with the
  user before adding a heavy native dependency.
- If the mobile PoC never wired translation, there is no reference
  implementation; verify against the web path and budget extra time.
- Rollback: additive to Phase 6; remove the mounts to ship video-only mobile
  first.
