'use client';

import { useEffect, useState } from 'react';
import { pausedMsBefore, type PauseInterval } from '@chatofy/realtime-client';
import { useTranslate } from '@/i18n/provider';

interface ElapsedClockProps {
  /** ISO-8601 instant the conversation started, from the hook. Null before the first start. */
  startedAt: string | null;
  /** The conversation's pauses so far, the last one open while it is paused. */
  pauses: readonly PauseInterval[];
}

/**
 * How long this conversation has been open.
 *
 * ## A leaf, and that is the whole design
 *
 * The tick has to live here and nowhere above. `CascadePanel` recomputes
 * `attributionStats` and `liveTurnsInOrder` on every render, and renders the
 * whole transcript under them — so a second's tick held one level up would
 * rebuild the entire screen once a second, on the same path a turn has to travel
 * through. Held here, React commits one text node.
 *
 * ## It counts active time, and stops while paused
 *
 * A pause stops this clock, the way a pause button promises. It shows wall time
 * since the start minus the paused time before the instant it reads at, and
 * while a pause is on it reads at the instant that pause began — so it holds
 * still rather than ticking on, and picks up where it left off on resume.
 *
 * That is the same number History shows for the conversation afterwards: the
 * save stores the paused total as `pausedMs`, and the card's duration is
 * `endedAt - startedAt - pausedMs`. It is also the timeline the recording has —
 * the recorder pauses with the conversation — so a timestamp the transcript
 * shows reads against this clock.
 *
 * ## Read once, not every second
 *
 * The accessible name is static and the live region is left off. A number that
 * re-announces itself every second would talk over the transcript, which is the
 * thing on this screen a screen-reader user is actually here for.
 */
export function ElapsedClock({ startedAt, pauses }: ElapsedClockProps) {
  const t = useTranslate();
  // Read at mount rather than re-seeded from an effect, so the first frame is
  // already right — a clock that started at zero would tell someone who
  // reloaded mid-conversation that it had only just begun. The interval is the
  // only thing the effect owns, which keeps a cascading render out of it.
  const [now, setNow] = useState(() => Date.now());

  const last = pauses.at(-1);
  // No tick while paused: the reading is pinned to the pause's start, so a
  // timer would only re-render the same text. Resuming restarts it.
  const paused = last !== undefined && last.endedAt === null;
  useEffect(() => {
    if (!startedAt || paused) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, paused]);

  if (!startedAt) return null;

  const began = Date.parse(startedAt);
  // Read at the pause's start while one is on — that is what freezes it. Just
  // after a resume `now` is still the last tick from BEFORE the pause, and read
  // there it would take the whole pause off a moment that came before it and
  // step the clock back; reading no earlier than the resume is what makes the
  // clock pick up exactly where it stopped.
  const readAt = paused ? last.startedAt : Math.max(now, last?.endedAt ?? now);
  // A malformed or future instant reads as 0:00 rather than as `NaN:aN`. Both are
  // reachable without a bug here: the value survives a reload, and a client clock
  // can move under it.
  const seconds = Number.isNaN(began)
    ? 0
    : Math.max(0, Math.floor((readAt - began - pausedMsBefore(pauses, readAt)) / 1000));

  return (
    <span
      aria-label={t('web.translate.elapsedLabel')}
      // `text-hint` is what the status label beside it uses, so the pair reads as
      // one line rather than two sizes. Tabular figures, or every digit change
      // shifts the text next to it.
      className="text-muted-foreground text-hint tabular-nums"
    >
      {formatElapsed(seconds)}
    </span>
  );
}

/**
 * `m:ss`, widening to `h:mm:ss` only once there is an hour to show.
 *
 * Minutes are not zero-padded under an hour: a conversation reads as `7:12`, the
 * way a stopwatch does, rather than as a timestamp.
 */
function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}
