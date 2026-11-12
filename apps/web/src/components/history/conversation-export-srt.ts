import type { Conversation, ConversationTurn } from '@chatofy/types';
import { activeDurationMs } from './conversation-formatting';
import {
  exportTurns,
  textLines,
  turnStart,
  turnText,
  turnTranslations,
} from './conversation-export-turns';

/** How long the last cue stays up at the least, when the conversation ends sooner. */
const LAST_CUE_MIN_MS = 5_000;

/** How long a cue stays up when the next one starts at the same moment. */
const MIN_CUE_MS = 1_000;

/**
 * Whether the conversation can be written as subtitles at all.
 *
 * Every cue needs a start, and a turn with no measured offset has none. Guessing
 * one — `0:00`, or the previous cue's end — would put a line on screen at a moment
 * it was not said, which is worse than offering no subtitles. So the whole format
 * is unavailable rather than a file with holes.
 */
export function canExportSrt(conversation: Pick<Conversation, 'turns' | 'languages'>): boolean {
  return exportTurns(conversation).every((turn) => turn.offsetMs !== null);
}

/** `HH:MM:SS,mmm`, the SubRip timestamp — a comma before the milliseconds, not a dot. */
export function srtTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (value: number, width = 2) => `${value}`.padStart(width, '0');
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1_000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(total % 1_000, 3)}`;
}

/**
 * A cue's own lines. `-->` is the timing line's separator, and a parser that meets
 * it in the text reads that line as a timing line; the arrow says the same thing.
 */
function cueLines(text: string): string[] {
  return textLines(text).map((line) => line.replaceAll('-->', '→'));
}

/**
 * The `.srt` export: one cue per turn, numbered from 1 in the order they play,
 * timed on the recording's clock — the same `mediaOffset` the transcript's gutter
 * and the player use. CRLF, as SubRip was written and some Windows players expect.
 *
 * Cues are sorted by start: turns are stored in display order, and two speakers
 * overlapping, or several turns clamped to 0 before the recording began, put a
 * later turn's start at or before an earlier one's. A cue runs until the next one
 * starts, so no two lines are up at once; when the next starts at the SAME moment
 * it runs for {@link MIN_CUE_MS} instead, because a zero-length cue is never shown.
 * The last runs to the end of the conversation's ACTIVE time (paused time excluded,
 * as the recording pauses with it), moved onto the same clock, or for five seconds
 * — whichever is later, so a line spoken right at the end is still readable.
 *
 * Throws when a turn has no offset: callers check {@link canExportSrt} first, and
 * writing a file with an invented time would be the silent version of that bug.
 */
export function transcriptSrt(conversation: Conversation): string {
  const timed = exportTurns(conversation).map((turn) => ({
    turn,
    start: turnStart(turn, conversation),
  }));
  if (timed.some(({ start }) => start === null)) {
    throw new Error('Every turn needs an offset to be written as subtitles');
  }
  const cues = (timed as { turn: ConversationTurn; start: number }[]).sort(
    (a, b) => a.start - b.start,
  );
  const end = activeDurationMs(conversation) - (conversation.audioOffsetMs ?? 0);

  const blocks = cues.map(({ turn, start }, index) => {
    const next = cues[index + 1]?.start;
    const stop =
      next === undefined
        ? Math.max(start + LAST_CUE_MIN_MS, end)
        : next > start
          ? next
          : start + MIN_CUE_MS;
    const text = [turnText(turn), ...turnTranslations(turn, conversation.languages)].flatMap(
      cueLines,
    );
    return [`${index + 1}`, `${srtTimestamp(start)} --> ${srtTimestamp(stop)}`, ...text].join(
      '\r\n',
    );
  });
  return blocks.length ? `${blocks.join('\r\n\r\n')}\r\n` : '';
}
