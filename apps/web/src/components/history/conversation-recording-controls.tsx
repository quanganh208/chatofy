'use client';

import type { RefObject } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button, Slider } from '@chatofy/ui/react';
import type { UseConversationPlayer } from '@/hooks/use-conversation-player';
import { useTranslate } from '@/i18n/provider';
import { formatOffset } from '@/lib/transcript-time';

interface ConversationRecordingControlsProps {
  player: UseConversationPlayer;
  /** Owned by the caller, which also hands it to `useConversationPlayer`. */
  audioRef: RefObject<HTMLAudioElement | null>;
  /** The scrubber's span — the STORED duration, see `ConversationDetail`. */
  totalMs: number;
}

/**
 * Play, scrub and the elapsed time, in the detail header beside the actions menu.
 *
 * Presentational: the player hook lives in `ConversationDetail`, because the
 * transcript's timestamps seek the same player.
 *
 * **Play is `outline`, never filled.** `accent-count.ts` counts `bg-primary` on
 * `button, a, [role="button"]`, and the screen's one accent is the minutes panel's
 * Generate. The `Slider`'s filled range is a `div` and is exempt, which that
 * counter's own docblock names as exactly this case. No card either: a recording is
 * something you scrub, not a record you act on as a unit.
 */
export function ConversationRecordingControls({
  player,
  audioRef,
  totalMs,
}: ConversationRecordingControlsProps) {
  const t = useTranslate();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="icon"
        onClick={player.toggle}
        disabled={player.loading}
        aria-label={t(player.playing ? 'web.history.pauseRecording' : 'web.history.playRecording')}
      >
        {player.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <Slider
        className="w-36 min-w-24"
        value={[Math.min(player.positionMs, totalMs)]}
        // Never 0: `audioDurationMs` is schema-valid at zero — a capture that
        // stopped the instant it started — and a Radix Slider built on `max={0}`
        // has no range to drag at all.
        max={Math.max(totalMs, 1)}
        step={1000}
        onValueChange={([ms]) => player.scrubTo(ms ?? 0)}
        aria-label={t('web.history.recordingLabel')}
      />
      <p className="text-muted-foreground text-hint tabular-nums">
        {formatOffset(player.positionMs)} / {formatOffset(totalMs)}
      </p>
      {/* `preload="none"`: the source is a blob that only exists after the first
          press, and preloading a 32 MB recording for a reader who came to READ
          would spend the feature's bandwidth on the people not using it. */}
      <audio ref={audioRef} src={player.src ?? undefined} preload="none" />
      {/* `role="status"` so the failure is ANNOUNCED rather than only drawn: a
          reader who pressed play and cannot see the bar gets silence otherwise. */}
      {player.failed ? (
        <p role="status" className="text-muted-foreground text-hint basis-full">
          {t('web.history.recordingFailed')}
        </p>
      ) : null}
    </div>
  );
}
