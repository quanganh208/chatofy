import type { ServerEvent, TranscriptSegment } from '@chatofy/types';

/**
 * What a conversation shows when several turns are being spoken at once.
 *
 * It replaced a single-turn reducer that kept exactly one `liveText` and one
 * `liveTranslation` for the whole conversation and cleared both on
 * `server.transcript.final` or `server.session.ended` regardless of which turn the
 * event belonged to. With one turn that was correct and simpler. With three it
 * fails twice over: three streams of partials overwrite each other, so the line on
 * screen flickers between sentences; and the first turn to finish wipes the live
 * line of a turn that is still being spoken.
 *
 * Keeping both and sharing one reducer between them would have meant a branch
 * inside it on how many turns exist — the opposite of the reason this package
 * exists — so this replaced it outright rather than generalising it.
 *
 * A reducer rather than a handful of state setters because the rule that matters
 * is about ORDERING: a live line must not survive the turn it belonged to, and a
 * partial that arrives after its own final must not reappear underneath it.
 * Ordering bugs are invisible in a component — nothing throws, the screen is
 * briefly wrong — and this project has shipped that defect twice in untested
 * client code.
 */

export interface LiveTurn {
  /** What the recogniser has heard of this turn so far. */
  text: string;
  /**
   * A translation of the unfinished sentence, when the turn ran long enough to be
   * worth guessing at. Empty otherwise.
   */
  translation: string;
}

export interface TurnKeyedTranscript {
  /** Finished turns, oldest first. */
  turns: TranscriptSegment[];
  /**
   * In-progress turns, keyed by the server's session id.
   *
   * Keyed by `sessionId` rather than by the client's `turnId` because every event
   * that carries live text carries the session id, and only that. A turn appears
   * here when its first partial arrives, not when it opens: a turn with nothing
   * transcribed yet has nothing to show.
   */
  live: Record<string, LiveTurn>;
}

export const initialTurnKeyedTranscript: TurnKeyedTranscript = {
  turns: [],
  live: {},
};

/**
 * Starting a fresh conversation, which no server event announces.
 *
 * Kept distinct from the contract rather than faked as a `server.*` event:
 * inventing one would make the shared schema a lie about what can arrive on the
 * socket.
 */
interface TranscriptReset {
  type: 'transcript.reset';
}

/**
 * A turn ended without the server saying so — refused at the ceiling, dropped at
 * the backlog ceiling, or released by the stall watchdog.
 *
 * Needed because those turns produce no `server.session.ended`, and a live line
 * left behind by one would sit on screen for the rest of the conversation. The
 * turn is named by the client's own id in some of those cases, so both names are
 * accepted.
 */
interface TurnAbandoned {
  type: 'transcript.turnAbandoned';
  sessionId?: string;
}

/**
 * A piece of continuous-mode text, which arrives as a delta and names no turn.
 *
 * The live backend has no turn boundaries: it emits `server.live.transcript`
 * deltas under one session id for as long as the conversation lasts. So this is
 * an APPEND, where every turn-based partial above is a wholesale rewrite — the
 * recogniser there re-reads the utterance and may revise a word, while here the
 * text already delivered is final and only grows.
 *
 * Also not faked as a `server.*` event, for the reason given on
 * {@link TranscriptReset}: `server.live.transcript` carries a delta, and
 * pretending it is a `server.transcript.partial` would put a whole-line meaning
 * on a field the schema says is a fragment.
 */
interface LiveTextAppended {
  type: 'transcript.liveDelta';
  sessionId: string;
  /** Which of the two texts grew: what was heard, or what was said back. */
  channel: 'source' | 'target';
  delta: string;
}

export type TurnKeyedAction = ServerEvent | TranscriptReset | TurnAbandoned | LiveTextAppended;

/**
 * Longest a continuous line is kept, in characters. The tail is what survives.
 *
 * A live session has no event that ever ends a line, so without this one meeting
 * is one string that grows for its whole length — and every partial re-renders
 * the overlay with all of it. Trimming to the tail matches what this transcript
 * already is elsewhere: a window, not an archive.
 */
const LIVE_LINE_MAX = 600;

function appendCapped(current: string, delta: string): string {
  const grown = current + delta;
  return grown.length <= LIVE_LINE_MAX ? grown : grown.slice(grown.length - LIVE_LINE_MAX);
}

/** Drop one turn's live entry, leaving every other turn untouched. */
function withoutLive(
  state: TurnKeyedTranscript,
  sessionId: string | undefined,
): TurnKeyedTranscript {
  if (!sessionId || !(sessionId in state.live)) return state;
  const live = { ...state.live };
  delete live[sessionId];
  return { ...state, live };
}

function patchLive(
  state: TurnKeyedTranscript,
  sessionId: string,
  patch: Partial<LiveTurn>,
): TurnKeyedTranscript {
  const current = state.live[sessionId] ?? { text: '', translation: '' };
  return { ...state, live: { ...state.live, [sessionId]: { ...current, ...patch } } };
}

export function turnKeyedTranscriptReducer(
  state: TurnKeyedTranscript,
  event: TurnKeyedAction,
): TurnKeyedTranscript {
  switch (event.type) {
    case 'transcript.reset':
      return initialTurnKeyedTranscript;

    case 'transcript.turnAbandoned':
      return withoutLive(state, event.sessionId);

    case 'transcript.liveDelta': {
      const current = state.live[event.sessionId] ?? { text: '', translation: '' };
      return patchLive(
        state,
        event.sessionId,
        event.channel === 'source'
          ? { text: appendCapped(current.text, event.delta) }
          : { translation: appendCapped(current.translation, event.delta) },
      );
    }

    case 'server.transcript.partial':
      // Rewritten wholesale rather than appended to: the recogniser re-reads the
      // whole utterance each time and can revise a word it already offered, so
      // treating this as a growing string would leave the correction behind.
      return patchLive(state, event.sessionId, { text: event.text });

    case 'server.translation.partial':
      return patchLive(state, event.sessionId, { translation: event.text });

    case 'server.transcript.final': {
      // The live lines and the finished turn are the same sentence, so keeping
      // both would show it twice. Only THIS turn's lines go — the crucial
      // difference from the single-turn reducer, which clears the conversation's
      // one live line and so wipes a sentence someone is still speaking.
      const cleared = withoutLive(state, event.sessionId);
      return { ...cleared, turns: [...cleared.turns, event.segment] };
    }

    case 'server.session.ended':
      // A turn can end with no transcript — no speech, or a failure. Whatever was
      // on its live lines is not coming back.
      return withoutLive(state, event.sessionId);

    case 'server.error':
      // Only a turn-scoped error clears a line. A connection-level fault names no
      // turn, and clearing every live line for one would erase the sentences of
      // turns that are still perfectly alive.
      return withoutLive(state, event.sessionId);

    default:
      return state;
  }
}

/**
 * Live turns in the order the server started them, for rendering.
 *
 * `Record` iteration order is insertion order for string keys, which is the order
 * partials first arrived — close enough to speaking order, and the only ordering
 * information this reducer has. The pipeline owns real speaking order.
 */
export function liveTurnsInOrder(state: TurnKeyedTranscript): (LiveTurn & { sessionId: string })[] {
  return Object.entries(state.live).map(([sessionId, turn]) => ({ sessionId, ...turn }));
}
