// Turn the finished conversation the reducer holds into the shape the minutes
// endpoint asks for.
//
// The API keeps no transcript (see the minutes HTTP contract), so the client
// sends the turns it already owns. This is the one place that projection lives,
// shared by every surface that offers minutes — web and extension both call it,
// rather than each re-deriving how a turn becomes a labelled line.
import type { MinutesSourceTurn } from '@chatofy/types';
import type { TurnKeyedTranscript } from './turn-keyed-transcript.js';
import { speakerFor } from './speaker-roster.js';

/**
 * Fallback label when a turn was never attributed to a roster speaker.
 *
 * The minutes are written for a human, so an unattributed turn still needs a
 * name to read — the a/b role is the one fact always present. Kept generic
 * ("Speaker A/B") rather than borrowing the direction, because who spoke is not
 * the same question as which language they spoke.
 */
const ROLE_FALLBACK: Record<string, string> = {
  speaker_a: 'Speaker A',
  speaker_b: 'Speaker B',
};

/**
 * Project the finished turns onto `{ speakerLabel, text }[]`, in spoken order.
 *
 * - `speakerLabel` is the roster label the user confirmed, falling back to the
 *   turn's a/b role — never the internal speaker id.
 * - `text` is the SOURCE-language line (the conversation as it happened), not the
 *   translation: the model summarizes what was said, and is told to write the
 *   minutes in the requested language itself.
 * - Empty lines are dropped; a turn the recognizer produced nothing for is not a
 *   turn worth summarizing.
 *
 * Takes only the three fields it reads so a caller can pass the hook's return
 * value or a hand-built fixture without constructing a whole reducer state.
 */
export function toMinutesSourceTurns(
  state: Pick<TurnKeyedTranscript, 'turns' | 'speakers' | 'attributions'>,
): MinutesSourceTurn[] {
  const out: MinutesSourceTurn[] = [];
  for (const turn of state.turns) {
    const text = turn.sourceText.trim();
    if (!text) continue;
    const speaker = speakerFor(state.speakers, state.attributions, turn.sessionId);
    const speakerLabel = speaker?.label ?? ROLE_FALLBACK[turn.speakerRole] ?? 'Speaker';
    out.push({ speakerLabel, text });
  }
  return out;
}
