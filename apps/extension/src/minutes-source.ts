import type { MinutesSourceTurn } from '@chatofy/types';
import type { TranscriptLine } from './messages';

/**
 * The two labels the extension has for a speaker.
 *
 * Unlike the web surface, the meeting overlay has no speaker roster — it knows
 * only which SIDE a line came from (`origin`). So the minutes name the sides,
 * and the worker supplies these already localized (there is no roster label to
 * prefer over them, the way the web surface prefers the name a user confirmed
 * on the roster).
 */
export interface MinutesSpeakerLabels {
  /** The meeting (inbound). */
  them: string;
  /** The person running the extension (outbound). */
  me: string;
}

/**
 * Project the overlay's transcript lines onto the minutes request shape.
 *
 * The only projection onto `MinutesSourceTurn` left on a client: the web app
 * stores its conversation and the API builds the prompt lines from the stored
 * turns. This one exists because the overlay carries `TranscriptLine[]`
 * (origin-sided, already in spoken order) and no stored conversation.
 *
 * - Only `final` lines are summarized; a line still growing is not settled.
 * - `text` is the SOURCE line (what was said), not the translation.
 * - Empty lines are dropped.
 *
 * NOTE the overlay is a bounded window (see `MeetingTranscript` /
 * `RETAINED_TURNS`), so this summarizes the RETAINED history, not necessarily an
 * hour-long meeting from its first word. Widening that is the worker's call —
 * see the overlay-wiring design in the plan.
 */
export function overlayLinesToMinutesSource(
  lines: readonly TranscriptLine[],
  labels: MinutesSpeakerLabels,
): MinutesSourceTurn[] {
  const out: MinutesSourceTurn[] = [];
  for (const line of lines) {
    if (!line.final) continue;
    const text = line.sourceText.trim();
    if (!text) continue;
    out.push({ speakerLabel: line.origin === 'me' ? labels.me : labels.them, text });
  }
  return out;
}
