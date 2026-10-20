import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import { DEFAULT_LANGUAGE_PAIR, reversePair, type LanguagePair } from '@chatofy/types';
import type { TranscriptLine } from './messages';

/**
 * Both legs' turns, merged into one thing to read.
 *
 * Two problems live here that neither leg's reducer can solve alone.
 *
 * The first is ORDER. Each leg keeps its own turn-keyed transcript, and
 * concatenating them produces two monologues rather than a conversation — every
 * sentence the user said below every sentence said to them. The turn segments
 * carry no timestamp, so order is recovered from the only clock available here:
 * when this process first saw each turn. That is the order they were spoken in,
 * because a turn is created when its speech starts.
 *
 * The second is LIFETIME. The transcript outlives the sessions. A dropped socket
 * ends a leg, and if its lines lived inside that leg's state the
 * meeting's history would vanish from the overlay at the exact moment something
 * went wrong — leaving the user with an error and no record of what was said.
 * These are cleared when a new capture begins, and at no other time.
 */

/** Lines kept per leg. The overlay is a window, not an archive. */
const RETAINED_TURNS = 20;

type MeetingLeg = 'inbound' | 'outbound';

const ORIGIN: Record<MeetingLeg, TranscriptLine['origin']> = {
  inbound: 'them',
  outbound: 'me',
};

export class MeetingTranscript {
  private readonly state: Record<MeetingLeg, TurnKeyedTranscript> = {
    inbound: initialTurnKeyedTranscript,
    outbound: initialTurnKeyedTranscript,
  };

  /**
   * Which pair each side is translated by, set by {@link clear}.
   *
   * Held here because a finished segment no longer names its pair, and the
   * overlay shows exactly one translation per line: the target of the side that
   * said it. The default is a placeholder — a capture clears with its own pair
   * before either side can apply a turn.
   */
  private pairs: Record<MeetingLeg, LanguagePair> = {
    inbound: DEFAULT_LANGUAGE_PAIR,
    outbound: reversePair(DEFAULT_LANGUAGE_PAIR),
  };

  /** First sight of each turn, which is the order the turns were spoken in. */
  private readonly firstSeen = new Map<string, number>();
  private seq = 0;

  apply(leg: MeetingLeg, action: TurnKeyedAction): void {
    this.state[leg] = turnKeyedTranscriptReducer(this.state[leg], action);
  }

  reset(leg: MeetingLeg): void {
    this.state[leg] = initialTurnKeyedTranscript;
  }

  /**
   * A new meeting, its side translated by `languagePair` and the user's by the
   * reverse. The previous meeting's lines must not appear in it.
   */
  clear(languagePair: LanguagePair): void {
    this.pairs = { inbound: languagePair, outbound: reversePair(languagePair) };
    this.state.inbound = initialTurnKeyedTranscript;
    this.state.outbound = initialTurnKeyedTranscript;
    this.firstSeen.clear();
    this.seq = 0;
  }

  /** Turns still open, both legs. Non-zero means a translation is behind. */
  get liveTurns(): number {
    return (
      Object.keys(this.state.inbound.live).length + Object.keys(this.state.outbound.live).length
    );
  }

  /** Every line worth showing, oldest first, whichever side said it. */
  lines(): TranscriptLine[] {
    const lines: TranscriptLine[] = [];

    for (const leg of ['inbound', 'outbound'] as const) {
      const transcript = this.state[leg];
      const origin = ORIGIN[leg];
      // Trimmed per leg rather than after the merge: a single cut across
      // both would drop whichever side had been quiet longest, so a talkative
      // user would slowly erase the meeting.
      for (const segment of transcript.turns.slice(-RETAINED_TURNS)) {
        // A mixed turn's map can carry more than one entry, and this overlay
        // shows exactly one: the target of the pair this side is translated by.
        const target = this.pairs[leg].target;
        lines.push({
          sessionId: segment.sessionId,
          sourceText: segment.sourceText,
          targetText: segment.translations[target] ?? '',
          final: true,
          origin,
        });
      }
      for (const [sessionId, turn] of Object.entries(transcript.live)) {
        lines.push({
          sessionId,
          sourceText: turn.text,
          targetText: turn.translation,
          final: false,
          origin,
        });
      }
    }

    for (const line of lines) {
      if (!this.firstSeen.has(line.sessionId)) this.firstSeen.set(line.sessionId, this.seq++);
    }

    return lines.sort(
      (a, b) => (this.firstSeen.get(a.sessionId) ?? 0) - (this.firstSeen.get(b.sessionId) ?? 0),
    );
  }
}
