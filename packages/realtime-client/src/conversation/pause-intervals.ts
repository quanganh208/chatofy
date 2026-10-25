/**
 * One stretch of a conversation spent paused, as epoch milliseconds from the
 * same `Date.now()` every capture timestamp in this tab is read from.
 *
 * `endedAt` is null while the pause is still on. It is closed by `resume()`, and
 * also by `finish()` and `stop()` when the conversation ends while paused: the
 * conversation stops being paused at the moment it stops, so the interval ends
 * there rather than at whatever instant someone next reads it.
 */
export interface PauseInterval {
  startedAt: number;
  endedAt: number | null;
}

/**
 * How much of the conversation before `at` was spent paused, in ms.
 *
 * Counts only the part of each interval that lies before `at`, and an interval
 * still open counts up to `at`. That is the one rule behind both readers:
 *
 * - a turn's stored offset is its wall time minus the paused time before it, so
 *   it lands in ACTIVE time — the timeline the recording has when the recorder
 *   is paused over exactly these intervals;
 * - the total, read at the end (or now), is what the conversation's duration
 *   leaves out.
 *
 * A non-finite `at` reads as no pause at all rather than propagating `NaN` or
 * `Infinity` into a stored offset.
 */
export function pausedMsBefore(pauses: readonly PauseInterval[], at: number): number {
  if (!Number.isFinite(at)) return 0;
  let total = 0;
  for (const pause of pauses) {
    const end = Math.min(pause.endedAt ?? at, at);
    if (end > pause.startedAt) total += end - pause.startedAt;
  }
  return total;
}
