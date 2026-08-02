import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import type { TranscriptLine } from './messages';

/**
 * Both directions' turns, merged into one thing to read.
 *
 * Two problems live here that neither direction's reducer can solve alone.
 *
 * The first is ORDER. Each direction keeps its own turn-keyed transcript, and
 * concatenating them produces two monologues rather than a conversation — every
 * sentence the user said below every sentence said to them. The turn segments
 * carry no timestamp, so order is recovered from the only clock available here:
 * when this process first saw each turn. That is the order they were spoken in,
 * because a turn is created when its speech starts.
 *
 * The second is LIFETIME. The transcript outlives the sessions. A dropped socket
 * ends a direction, and if its lines lived inside that direction's state the
 * meeting's history would vanish from the overlay at the exact moment something
 * went wrong — leaving the user with an error and no record of what was said.
 * These are cleared when a new capture begins, and at no other time.
 */

/** Lines kept per direction. The overlay is a window, not an archive. */
const RETAINED_TURNS = 20;

type Direction = 'inbound' | 'outbound';

const ORIGIN: Record<Direction, TranscriptLine['origin']> = {
  inbound: 'them',
  outbound: 'me',
};

export class MeetingTranscript {
  private readonly state: Record<Direction, TurnKeyedTranscript> = {
    inbound: initialTurnKeyedTranscript,
    outbound: initialTurnKeyedTranscript,
  };

  /** First sight of each turn, which is the order the turns were spoken in. */
  private readonly firstSeen = new Map<string, number>();
  private seq = 0;

  apply(direction: Direction, action: TurnKeyedAction): void {
    this.state[direction] = turnKeyedTranscriptReducer(this.state[direction], action);
  }

  reset(direction: Direction): void {
    this.state[direction] = initialTurnKeyedTranscript;
  }

  /** A new meeting. The previous one's lines must not appear in it. */
  clear(): void {
    this.state.inbound = initialTurnKeyedTranscript;
    this.state.outbound = initialTurnKeyedTranscript;
    this.firstSeen.clear();
    this.seq = 0;
  }

  /** Turns still open, both directions. Non-zero means a translation is behind. */
  get liveTurns(): number {
    return (
      Object.keys(this.state.inbound.live).length + Object.keys(this.state.outbound.live).length
    );
  }

  /** Every line worth showing, oldest first, whichever side said it. */
  lines(): TranscriptLine[] {
    const lines: TranscriptLine[] = [];

    for (const direction of ['inbound', 'outbound'] as const) {
      const transcript = this.state[direction];
      const origin = ORIGIN[direction];
      // Trimmed per direction rather than after the merge: a single cut across
      // both would drop whichever side had been quiet longest, so a talkative
      // user would slowly erase the meeting.
      for (const segment of transcript.turns.slice(-RETAINED_TURNS)) {
        lines.push({
          sessionId: segment.sessionId,
          sourceText: segment.sourceText,
          targetText: segment.targetText,
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
