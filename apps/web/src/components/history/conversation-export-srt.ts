import type { Conversation } from '@chatofy/types';
import { activeDurationMs } from './conversation-formatting';
import { turnStart, turnText, turnTranslations } from './conversation-export';

/** How long the last cue stays up at the least, when the conversation ends sooner. */
const LAST_CUE_MIN_MS = 5_000;

/**
 * Whether the conversation can be written as subtitles at all.
 *
 * Every cue needs a start, and a turn with no measured offset has none. Guessing
 * one — `0:00`, or the previous cue's end — would put a line on screen at a moment
 * it was not said, which is worse than offering no subtitles. So the whole format
 * is unavailable rather than a file with holes.
 */
export function canExportSrt(conversation: Pick<Conversation, 'turns'>): boolean {
  return conversation.turns.every((turn) => turn.offsetMs !== null);
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
 * A blank line ends a cue in SubRip, so text that carries one would split a cue in
 * two and misnumber every cue after it. Collapsed to single line breaks.
 */
function cueLine(text: string): string {
  return text.replace(/\n\s*\n+/g, '\n').trim();
}

/**
 * The `.srt` export: one cue per turn, numbered from 1, timed on the recording's
 * clock — the same `mediaOffset` the transcript's gutter and the player use.
 *
 * A cue runs until the next one starts, so a reader never sees two lines at once
 * nor a gap between turns. The last runs to the end of the conversation's ACTIVE
 * time (paused time excluded, as the recording pauses with it), moved onto the
 * same clock, or for five seconds — whichever is later, so a line spoken right at
 * the end is still readable.
 *
 * Throws when a turn has no offset: callers check {@link canExportSrt} first, and
 * writing a file with an invented time would be the silent version of that bug.
 */
export function transcriptSrt(conversation: Conversation): string {
  const starts = conversation.turns.map((turn) => turnStart(turn, conversation));
  if (starts.some((start) => start === null)) {
    throw new Error('Every turn needs an offset to be written as subtitles');
  }
  const times = starts as number[];
  const end = activeDurationMs(conversation) - (conversation.audioOffsetMs ?? 0);

  const cues = conversation.turns.map((turn, index) => {
    const start = times[index]!;
    const next = times[index + 1];
    const stop =
      next === undefined ? Math.max(start + LAST_CUE_MIN_MS, end) : Math.max(next, start);
    const text = [turnText(turn), ...turnTranslations(turn, conversation.languages)]
      .map(cueLine)
      .filter((line) => line !== '');
    return [`${index + 1}`, `${srtTimestamp(start)} --> ${srtTimestamp(stop)}`, ...text].join('\n');
  });
  return cues.length ? `${cues.join('\n\n')}\n` : '';
}
