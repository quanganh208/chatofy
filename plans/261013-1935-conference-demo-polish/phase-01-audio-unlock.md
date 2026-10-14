# Phase 1 — Audio unlock (item A)

**Goal:** translated TTS audio reliably plays in the demo. Today `TranslationAudioSink` creates
one `AudioContext` per speaker in `getOrCreate` off a WebSocket callback and never calls
`resume()`; Chrome's autoplay policy starts such a context **suspended**, so TTS can be silent
for the whole session with no error.

## Files owned

- `apps/web/src/hooks/use-translation-audio-sink.ts` (edit) — `resume()` on create; track and
  expose whether any context is suspended; a method to resume all on demand.
- `apps/web/src/hooks/use-conference.ts` (edit) — call the sink's resume after join (join is
  reached via a lobby click, so a gesture exists in the chain); expose `audioBlocked: boolean`
  on the return.
- `apps/web/app/(app)/conference/[roomId]/page.tsx` (edit) — when `audioBlocked`, render a
  "tap to enable sound" affordance that resumes all contexts on click.
- `packages/i18n/src/en.ts` + `vi.ts` (edit) — the tap-to-enable strings.

## Steps

1. In the sink, call `void ctx.resume()` immediately after `new AudioContext(...)`. Add
   `isAnySuspended(): boolean` (scan `speakers` for `ctx.state === 'suspended'`) and
   `resumeAll(): Promise<void>` (resume every context). This is the guaranteed-correct hook for a
   user-gesture handler.
2. In `useConference`, add `audioBlocked` state. After the join sequence completes (and whenever a
   TTS frame is pushed), reflect `sink.isAnySuspended()` into `audioBlocked`. Expose it on the
   return. Also attempt `void sink.resumeAll()` once at join.
3. In the room page, when `audioBlocked` is true show a small dismissible banner/button
   ("tap to enable sound") that calls a hook action resuming all contexts and clears the flag.
   Keep it a readout/ghost control — NOT an accent fill (Leave stays the one accent control).
4. i18n keys (en + vi), then `pnpm --filter @chatofy/i18n build`.

## Verification

- `pnpm --filter web typecheck` + `build` + `test` green.
- Code path check: after `new AudioContext`, `resume()` is invoked; `resumeAll()` is wired to the
  tap affordance; `audioBlocked` toggles off after a successful resume.
- Manual (live stack, Phase-5-style note): with a real call, TTS is audible; if the browser still
  blocks it, the tap affordance appears and enables sound after one click.

## Acceptance

TTS audio plays without a silent-failure path; a suspended context always has a visible one-tap
recovery. Specs green.

## Risk / rollback

Additive. Rollback = drop the `resume()`/`resumeAll()` and the banner; behavior returns to today.
