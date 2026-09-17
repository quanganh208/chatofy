import { HISTORY_LIMITS } from '@chatofy/types';

/**
 * The one place a transcript timestamp is computed and written.
 *
 * Both screens that mark a turn with a time read from here: `/translate` while
 * the conversation is running and `/history/[conversationId]` reading it back.
 * That is the point of the module rather than a tidiness argument — the two
 * numbers are required to be the same string for the same block, and the only
 * way to hold that is for both to be the same two function calls over the same
 * two inputs. Living in `components/history/` while the translate screen also
 * needed them is what would make a second, slightly different rounding likely.
 */

/**
 * A position inside a recording, as `m:ss` — or `h:mm:ss` past an hour.
 *
 * **No dictionary key, and that is deliberate rather than an omission.** Both
 * locales write these with latin digits and a colon, so `00:06` reads identically
 * on either — a key would be a "translation" that can never differ from its
 * source, and the compiler-enforced parity would then guard nothing. It is
 * `padStart`, not `Intl`.
 *
 * Seconds are FLOORED, not rounded. This labels a moment a reader can seek to: a
 * line that begins at 5.9s and reads "0:06" sends the player past its own first
 * syllable, while "0:05" lands just before it. Early is recoverable by listening;
 * late has already cut the word off.
 *
 * A negative — which `mediaOffset` clamps away before this is reached — renders
 * as `0:00` rather than `-0:01`, because a gutter is not the place to report a
 * clock disagreement.
 */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = `${total % 60}`.padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${`${minutes}`.padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Where a stored turn sits in the RECORDING, given where the recording began.
 *
 * A turn's `offsetMs` is measured from the conversation's `startedAt`, which is
 * stamped before the microphone is even requested; the recording begins later, by
 * however long the permission prompt, the worklet load and the socket connect
 * took. Subtracting `audioOffsetMs` is what turns conversation time into media
 * time.
 *
 * **This must be used for the DISPLAYED number as well as for the seek.** An
 * earlier draft subtracted only when seeking, which left the gutter reading one
 * time and the player's own readout another — the two disagreeing by exactly that
 * startup interval, which is small enough to look like a rounding bug and large
 * enough to miss a short sentence.
 *
 * The live screen applies it too, against the offset it is about to store, which
 * is what makes a turn read the same during the conversation and afterwards.
 * There, a null `audioOffsetMs` means the microphone never opened, and the
 * conversation time it falls through to is exactly what `/history` will fall
 * through to for the same conversation.
 *
 * Null in, null out: a turn with no capture record has no position to show.
 */
export function mediaOffset(offsetMs: number | null, audioOffsetMs: number | null): number | null {
  if (offsetMs === null) return null;
  return Math.max(0, offsetMs - (audioOffsetMs ?? 0));
}

/**
 * How long after the conversation started the first sample landed.
 *
 * The recorder's own clock against the conversation's own start, which is what
 * the upload sends and what the API stores — so a timestamp shown live and the
 * same timestamp read back out of history are shifted by the identical number.
 * Computing it in two places is how they would come to differ.
 *
 * Null when the microphone never opened for this conversation, or before it has:
 * there is no recording origin yet, so there is no shift to apply.
 */
export function recordingOffsetMs(
  recordingStartedAtMs: number | null,
  startedAt: string | null,
): number | null {
  if (recordingStartedAtMs === null || !startedAt) return null;
  const began = Date.parse(startedAt);
  // A malformed `startedAt` is not a reason to shift every timestamp by `NaN`.
  // No origin reads as "no shift", which is the same answer a conversation with
  // no recording gets.
  if (Number.isNaN(began)) return null;
  // Bounded at both ends, the way `displayGroupOffsetMs` bounds the offset this
  // is subtracted from. The floor is a clock disagreement; the ceiling is the
  // bound both write schemas enforce, and an over-cap value here would 400 the
  // whole save — turns included — rather than cost one timestamp. Not reachable
  // today, since `endedAt` is stamped after the recorder attached and the body's
  // own duration refine would refuse such a conversation first; it is here so
  // the pair that must agree is bounded the same way on both sides.
  return Math.min(Math.max(0, recordingStartedAtMs - began), HISTORY_LIMITS.MAX_DURATION_MS);
}

/**
 * `PT1M12S` — the machine-readable half of `<time>`.
 *
 * A screen reader announces the visible `1:12` either way; this is what makes the
 * element a real duration rather than a styled span, so the markup says what the
 * number means without a second visible string to translate.
 */
export function isoDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `PT${Math.floor(total / 60)}M${total % 60}S`;
}
