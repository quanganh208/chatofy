# Phase 3 — Translation robustness: bidirectional routing + ordered audio + subtitle stability

**Goal:** make translation actually work both ways for a vi↔en demo and sound clean. Today it
only ever translates to English and plays each TTS frame on its own `AudioContext` (overlapping,
out of order). This phase fixes the three correctness issues behind the translation path.

## Context (the exact bugs, grounded)

1. `wireTranslate()` sets `const direction = \`${sourceLanguage}_to_en\``and the subtitle`targetLang: 'en'` (`conference-poc/page.tsx:639,718`; carried into the Phase 1 hook). A
vi speaker → `vi_to_en`(ok); an en speaker →`en_to_en` (invalid) and vi listeners get
   nothing in Vietnamese.
2. Each `conference.translation.audio` frame does `new AudioContext(...)` + immediate `start()`
   (`page.tsx:334–353`) → no ordering, no gapless scheduling, a leaked context per frame.
3. Subtitles are keyed by `speakerSocketId` only and cleared on a 4 s timer; partial/final frames
   of one utterance (`turnId`) are not coalesced, so text can flicker/append oddly.

The server router (`conference-translation-router.service.ts`) already does self-filter + skips
same-language listeners, which is correct for a 2-language room **once the direction is right**.

## Files this phase owns

- `apps/web/src/hooks/use-conference.ts` (edit: `direction` computation, subtitle coalescing, swap
  the audio sink).
- `apps/web/src/hooks/use-translation-audio-sink.ts` (new) — ordered playback queue (or a thin
  wrapper over `@chatofy/realtime-client` ordered playback).
- `packages/realtime-client/**` (edit **only if** its ordered-playback export needs a small,
  backward-compatible addition to be reusable here; otherwise leave untouched).
- `apps/api/src/modules/conference/services/conference-translation-router.service.ts` (edit **only
  if** per-direction routing needs a tweak — expected NO change, verify first).
- `docs/video-conference-translation-audio.md` (edit: record the bidirectional fix + demo env).

Does not touch Phase 2's components. If Phase 2 runs concurrently, coordinate that the hook's
public surface stays stable (append fields, don't rename).

## Steps

1. **Bidirectional direction.** Compute the target as the _other_ language in the pair:
   `targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en'`; `direction = \`${sourceLanguage}_to_${targetLanguage}\``.
Set the subtitle's `targetLang`to`targetLanguage`and`lang`on the audio frame accordingly.
Verify`/ws/translate`accepts`en_to_vi`(it must — the app ships vi↔en both ways; check`register-default-providers.ts` / the live direction parsing). Keep the server router as-is:
   with correct directions, Rule 2 (skip same-language peers) already routes vi→en output to the
   en listeners and en→vi output to the vi listeners.
2. **Ordered audio sink.** Replace the per-frame context with one `AudioContext` per _speaker_
   (or one shared, keyed by `speakerSocketId`), buffering frames by `sequence` and scheduling each
   at `max(ctx.currentTime, nextStartTime)` so they play gapless and in order. Prefer reusing
   `@chatofy/realtime-client`'s ordered playback (README §realtime-client "ordered playback")
   rather than hand-rolling; only hand-roll if its API can't accept these PCM16 frames cleanly.
   Close contexts on `leave()`.
3. **Subtitle coalescing.** Key the overlay by `(speakerSocketId, turnId)`: replace text while
   `isFinal === false`, lock on final, then clear on the existing timer. Prevents flicker.
4. **Concurrency headroom for the demo.** Document (and wire via env in the runbook) raising
   `MAX_CONCURRENT_TURNS_GLOBAL` and `LOCAL_STT_CONCURRENCY` to ≥12 / ≥6 so 3 simultaneous
   speakers don't queue (per `docs/video-conference-translation-audio.md §3`). No code default
   change — env only.

## Verification

- Two tabs, **en speaker**: the **vi** listener sees a Vietnamese subtitle and hears Vietnamese
  TTS; reverse with a vi speaker → en listener. (The current PoC fails this — it's the headline
  fix.)
- Translated audio across a multi-frame utterance plays **in order, without overlap**; only one
  `AudioContext` per speaker exists (check via DevTools memory/no leak over a minute).
- Subtitle text updates in place during an utterance and doesn't flicker/duplicate; clears after
  final.
- 3-tab smoke with 2–3 speakers: no audio pile-up; latency comparable to the measured ~6 s warm.

## Acceptance criteria

- vi↔en translation works in **both** directions for subtitle and audio.
- Ordered, gapless TTS playback with no per-frame context leak.
- Stable subtitles; demo-env concurrency documented.

## Risk / rollback

Hook + optional one-line router/realtime-client edits. Rollback = revert the `direction` change
and restore the inline per-frame audio playback. Low blast radius; `/conference-poc` unaffected
unless you also choose to backport (not required).
