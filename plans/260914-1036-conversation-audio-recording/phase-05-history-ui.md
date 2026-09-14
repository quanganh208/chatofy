---
phase: 5
title: 'Phase 5: History UI — the timestamp gutter and the player'
status: completed
priority: P1
effort: '5-6h'
dependencies: [1, 4]
---

# Phase 5: History UI — the timestamp gutter and the player

## Overview

Put the times in the transcript and a player above it, without spending design budget the
screen does not have.

This is the phase where the two mechanical design gates bite. `/history/[conversationId]`
sits at **`filled: 1, surfaces: 2` — both ceilings, exactly spent**. The two elevated
surfaces are the transcript `Card` and the minutes `Card`; the one accent is `MinutesPanel`'s
Generate button. `conversation-detail.tsx:22-55` says so in its own docblock and explains
why back is ghost and delete is outline. A player in a third `Card` fails
`accent-budget-app.spec.tsx`; a `bg-primary` Play button fails it too. Neither is a style
opinion — both are test failures.

The bar therefore lives on the page ground between hairlines, with an outline Play. That is
not a compromise: the recording is something you scrub, not a record you act on as a unit,
so it was never a card in the first place.

## Requirements

Functional:

- Every block with an `offsetMs` shows it in a left gutter as `m:ss` (or `h:mm:ss`).
- Clicking a gutter time seeks the player to that utterance — **subject to Phase 1**.
- A playback bar with play/pause, a scrubber and an elapsed/total readout.
- The blob is fetched on the **first press of play**, never on mount.
- A conversation with no recording, or a row with no offset, renders today's layout.

Non-functional:

- `filled` stays 1 and `surfaces` stays 2 on every state of this screen.
- **No `opacity-*` anywhere in the gutter.** The contrast specs read tokens, so a
  composited opacity passes them while breaking the rule they exist for — that is how a
  `/history` line once shipped at 4.07:1 (`development-rules.md` records it).
- Times are not a dictionary key: both locales use latin digits and read `00:06`
  identically, so this is `padStart`, not `Intl`.

## Files

Owned by this phase:

- `apps/web/src/components/history/conversation-formatting.ts` — `formatOffset`
- `apps/web/src/components/history/history-transcript.tsx` — the gutter
- `apps/web/src/components/history/conversation-detail.tsx` — the bar
- `apps/web/src/hooks/use-conversation-player.ts` (new)
- `apps/web/src/design/accent-budget-app.spec.tsx` — two new rows
- `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts` — the `web.history.*` keys only
  (the landing amendment is Phase 6)
- Specs beside each

## Steps

1. **`formatOffset(ms)`** — `m:ss` under an hour, `h:mm:ss` above. Beside `formatTime` and
   `durationMinutes` rather than in a new file.

2. **`use-conversation-player.ts`** — holds `{ hasRecording, blobUrl, playing, currentMs, totalMs, load, toggle, seekTo }`.
   Fetches the blob on first play. `totalMs` comes from the stored `audioDurationMs`, never
   from `audio.duration`, because `MediaRecorder` writes no Duration into the WebM header.
   If Phase 1 showed the prime is needed, it lives here and nowhere else.

3. **The bar** in `conversation-detail.tsx`, between the header facts row and
   `<HistoryTranscript>`:

   ```tsx
   {
     conversation.hasRecording ? (
       <div className="border-hairline flex items-center gap-3 border-t border-b py-3">
         <Button
           variant="outline"
           size="icon"
           onClick={toggle}
           aria-label={t(playing ? 'web.history.pauseRecording' : 'web.history.playRecording')}
         >
           {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
         </Button>
         <Slider
           value={[currentMs]}
           max={totalMs}
           onValueChange={([ms]) => seekTo(ms)}
           aria-label={t('web.history.recordingLabel')}
         />
         <p className="text-muted-foreground text-hint tabular-nums">
           {formatOffset(currentMs)} / {formatOffset(totalMs)}
         </p>
         <audio ref={audioRef} src={blobUrl ?? undefined} preload="none" />
       </div>
     ) : null;
   }
   ```

   Both gates hold **by construction, not by luck**, and the comment should say so: the bar
   is a `div` with no `data-slot="card"` and no `shadow-elev-md|lg`, so `elevatedSurfaces`
   still counts the same two; Play is `outline`, and the `Slider`'s filled range is a `div`,
   which `accentFilledControls` skips because it restricts to `button, a, [role="button"]`
   — `accent-count.ts` names the slider as exactly this case.

4. **The gutter** in `history-transcript.tsx`. One new optional prop
   `onSeek?: (ms: number) => void`. The `<li>` becomes a gutter plus the existing block,
   with the left rule kept where its docblock defends it:

   ```tsx
   <li className="flex gap-3">
     <div className="w-12 shrink-0 pt-0.5 text-right">
       {turn.offsetMs === null ? null : onSeek ? (
         <button
           type="button"
           onClick={() => onSeek(mediaMs(turn.offsetMs))}
           className="text-label text-muted-foreground hover:text-foreground tabular-nums"
           aria-label={t('web.history.playFrom', { time: formatOffset(mediaMs(turn.offsetMs)) })}
         >
           {formatOffset(mediaMs(turn.offsetMs))}
         </button>
       ) : (
         <span className="text-label text-muted-foreground tabular-nums">
           {formatOffset(mediaMs(turn.offsetMs))}
         </span>
       )}
     </div>
     <div className="border-primary flex flex-col gap-1 border-l-2 pl-4">
       {/* the unchanged three lines */}
     </div>
   </li>
   ```

5. **The gutter displays media time, not conversation time.** `mediaMs(offsetMs) = max(0, offsetMs − audioOffsetMs)`,
   in **one** helper used by both the label and the seek. This is the correction the
   verifier caught in the winning brief, which subtracted on seek but displayed the
   unadjusted number — leaving the gutter and the player readout disagreeing by the
   permission-prompt interval. The number in the gutter must be the number on the player.

6. **`<time dateTime>` where it helps.** Wrap the value in `<time dateTime="PT1M12S">` so
   screen readers get a real element rather than a bare number.

7. **Accent-gate rows.** Add two named rows to `accent-budget-app.spec.tsx`, both at
   `filled: 1, surfaces: 2`: `'/history/[conversationId] — with a recording'` and
   `'— the recording failed to load'`. The failure row matters because an error state is
   where a `Card` or a filled retry button would most plausibly creep in. Mock the player
   hook the way `useMinutes` is mocked at line 79, so the spec performs no fetch.

## Validation

```bash
pnpm --filter web test
pnpm typecheck
pnpm lint
```

Test cases that must exist:

- A turn with `offsetMs: null` renders an empty gutter, not `0:00`.
- A conversation with `hasRecording: false` renders no bar and no gutter times.
- The gutter label equals `offsetMs − audioOffsetMs`, formatted — asserted against a
  fixture where `audioOffsetMs` is non-zero, or the bug this step fixes cannot regress-fail.
- Clicking a gutter button calls `onSeek` with the same media milliseconds it displays.
- The blob is not fetched on mount; it is fetched on the first `toggle`.
- `accent-budget-app.spec.tsx` passes with `KNOWN_VIOLATIONS` still `{}` and the two new
  rows at `filled: 1, surfaces: 2`.
- `pnpm typecheck` fails if a `web.history.*` key is added to `en.ts` and not `vi.ts`.

## Risk and rollback

**Risk: seeking a blob does not work.** This is what Phase 1 exists to answer before this
phase starts. If it cannot be made to work, the gutter ships as plain text — delete the
`onSeek` branch — and the scrubber becomes position-only. Everything else stands.

**Risk: layout at phone width.** happy-dom has no box model, so no gate can see it: a
12-unit gutter plus the existing left rule and padding is the kind of thing that overflows
at ~400px. This is a **review item**, and it belongs in Phase 6's manual matrix.

**Risk: the bar creeps into a card in review.** The two new spec rows are what stop that,
and they fail in both directions — a row that stops violating fails as stale, so the table
cannot decay into a list of excuses.

**Rollback:** remove the bar and pass no `onSeek`. `HistoryTranscript` renders its
pre-existing three lines and the screen is byte-identical to today.
