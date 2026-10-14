# Phase 3 — Translation UX (subtitles, transcript, language picker)

**Goal:** surface the Phase 2 translation plumbing in the call view — a subtitle overlay on the
speaking tile, a transcript sheet for the whole call, a source-language picker, and the
`translating…` pending indicator — at parity with web.

## Context

Phase 2 produces the subtitle events (`ConferenceTranslationSubtitle` with partial/final `isFinal`
and `turnId`) and drives `localTranslating` in the hook. The subtitle **state machine** already
lives in `use-conference-native.ts` (keyed by `(speakerSocketId, turnId)`, replace-on-partial,
clear on final or a 4 s timeout — ported from web in Phase 1/2). This phase is **components only**
plus mounting them; no new signaling. Reuse `@chatofy/ui` tokens and `@chatofy/i18n` keys; the
picker drives the `sourceLanguage` passed to `join()` and the translate direction.

## Files this phase owns

- `apps/mobile/src/components/conference/subtitle-overlay.tsx` — latest caption on the speaking
  tile, fed from the hook's subtitle state.
- `apps/mobile/src/components/conference/transcript-sheet.tsx` — accumulated turns for the call
  (bottom sheet using the existing `react-native-gesture-handler`/`reanimated` stack).
- `apps/mobile/src/components/conference/language-picker.tsx` — source-language selector.
- Call-view edits (`app/(app)/conference/[roomId].tsx`) to mount the overlay, sheet, picker, and
  the `translating…` badge on the local tile.
- i18n keys for picker labels + the translating indicator in `packages/i18n/src/{en,vi}.ts`.

## Steps

1. **Read first:** web Phase 2/3 result for subtitle `isFinal`/`turnId` semantics and the
   translating-badge timing; the hook's subtitle state shape from Phase 1/2; `src/ui/theme.ts`
   token usage in existing components.
2. Build `subtitle-overlay.tsx`; bind to the hook's current subtitle for the active speaker.
   → verify: captions render on the speaking tile and clear on final/timeout.
3. Build `transcript-sheet.tsx` accumulating the call's turns (newest visible, scrollable history).
   → verify: the sheet holds every turn of a multi-turn call; open/close gesture works.
4. Build `language-picker.tsx`; wire it to the `sourceLanguage` argument of `join()` and the bridge
   direction. Tokens + i18n only, no hardcoded strings.
   → verify: changing the picker changes the real translation direction (vi↔en).
5. Mount all three in the call view + the `translating…` badge on the local tile bound to
   `localTranslating`.
   → verify: cross-platform subtitle shows both directions; badge appears on speech and clears.

## Verification

- Mobile↔web subtitles render both directions; transcript accumulates; picker drives the real
  direction.
- `translating…` badge appears when speaking and never sticks.
- `token-parity.spec.ts` green; no hardcoded colors/strings; i18n keys present in en + vi.

## Risk / rollback

- If a turn's final subtitle never arrives, the timeout clear (already in the hook) prevents a
  stuck caption — verify the timeout fires.
- Rollback: additive components; unmounting them leaves Phase 2's audio-only translation (no
  captions) working, and Phase 1's video call under that.
