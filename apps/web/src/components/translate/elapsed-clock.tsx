'use client';

import { useEffect, useState } from 'react';
import { useTranslate } from '@/i18n/provider';

interface ElapsedClockProps {
  /** ISO-8601 instant the conversation started, from the hook. Null before the first start. */
  startedAt: string | null;
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
 * ## It counts the conversation, not the talking
 *
 * The clock keeps running while paused. That is a deliberate trade against the
 * intuition of a pause button, and it buys the one thing a reader can check: the
 * stored duration is `endedAt - startedAt`, stamped once when the conversation
 * ends, so a clock that subtracted paused time would disagree with the card in
 * History for the same conversation. Excluding it would mean storing accumulated
 * pause as well — a change to what is saved, which this is not.
 *
 * The status beside it is what says the microphone is off, so the pair reads
 * correctly: paused, and twelve minutes in.
 *
 * ## Read once, not every second
 *
 * The accessible name is static and the live region is left off. A number that
 * re-announces itself every second would talk over the transcript, which is the
 * thing on this screen a screen-reader user is actually here for.
 */
export function ElapsedClock({ startedAt }: ElapsedClockProps) {
  const t = useTranslate();
  // Read at mount rather than re-seeded from an effect, so the first frame is
  // already right — a clock that started at zero would tell someone who
  // reloaded mid-conversation that it had only just begun. The interval is the
  // only thing the effect owns, which keeps a cascading render out of it.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;

  const began = Date.parse(startedAt);
  // A malformed or future instant reads as 0:00 rather than as `NaN:aN`. Both are
  // reachable without a bug here: the value survives a reload, and a client clock
  // can move under it.
  const seconds = Number.isNaN(began) ? 0 : Math.max(0, Math.floor((now - began) / 1000));

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
