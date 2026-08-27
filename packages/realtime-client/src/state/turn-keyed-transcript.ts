import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  addSpeaker,
  attributeTurn,
  removeSpeaker,
  renameSpeaker,
  unattributeTurn,
  type AttributionsBySession,
  type SessionSpeaker,
} from './speaker-roster.js';
import { buildCentroids, suggestSpeaker, type EmbeddingsBySession } from './speaker-centroids.js';

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
  /**
   * Who is in this conversation.
   *
   * Held here rather than above the reducer because its lifetime is the
   * conversation's. The panel that owns this state releases the microphone and
   * closes the socket when it unmounts, so a roster that outlived it would be
   * names for turns that no longer exist. `direction` is deliberately held
   * higher up and is different in kind — it configures the NEXT session, while
   * this describes the one running.
   */
  speakers: SessionSpeaker[];
  /** Who said each finished turn, keyed by the server's `sessionId`. */
  attributions: AttributionsBySession;
  /**
   * The number the next participant gets.
   *
   * State rather than `speakers.length + 1`: removing an unattributed speaker
   * would otherwise let the next id collide with one already in use.
   */
  nextSpeakerNumber: number;
  /**
   * Voice vectors for finished turns, while the acoustic layer is switched on.
   *
   * Kept so a profile can be rebuilt from every confirmed turn each time a new
   * vector arrives, rather than accumulated into running totals. Same reason the
   * statistics are derived: a total kept alongside the turns can disagree with
   * them, and re-deriving a handful of averages over a conversation costs
   * nothing. They live and die with everything else here.
   */
  embeddings: EmbeddingsBySession;
  /**
   * What capture measured about each finished turn, keyed by the server's
   * `sessionId`.
   *
   * Separate from `turns` because it arrives separately and later — see
   * {@link TurnCaptureRecorded}. Rendering joins the two; a turn with no entry
   * here simply never merges, which is the safe direction to fail.
   */
  captures: CapturesBySession;
  /**
   * Repaired display text per turn, keyed by the server's `sessionId`.
   *
   * Read as `displays[sessionId] ?? segment.sourceText`. Empty until the
   * display-repair phase produces it; the fallback is what makes that safe.
   */
  displays: Record<string, string>;
}

/** What capture measured about one finished turn. */
export interface TurnCapture {
  cutForced: boolean;
  /** Epoch ms the microphone opened on the turn. Orders the transcript. */
  openedAt: number;
  /** Epoch ms capture finished with it. Bounds the merge gap. */
  closedAt: number;
}

export type CapturesBySession = Record<string, TurnCapture>;

export const initialTurnKeyedTranscript: TurnKeyedTranscript = {
  turns: [],
  live: {},
  speakers: [],
  attributions: {},
  nextSpeakerNumber: 1,
  embeddings: {},
  captures: {},
  displays: {},
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
 * What capture measured about one finished turn.
 *
 * Client-side rather than a server event because the server cannot know either
 * field: `cutForced` is the length ceiling firing in this tab's own gate, and
 * `openedAt` is when the microphone opened, not when a translation came back.
 * `clientTurnMetricsSchema` carries `cutForced` in the other direction — client
 * to server — which is why nothing on `TranscriptSegment` has it.
 *
 * **Arrives AFTER the segment it describes.** The pipeline reports a close
 * through `onTurnClosed`, fired from `forget()` when the SERVER closes the turn,
 * so `server.transcript.final` has already landed. The reducer therefore keys
 * these separately and lets rendering join them, rather than trying to attach
 * one to the other on arrival.
 */
interface TurnCaptureRecorded {
  type: 'transcript.turnCaptureRecorded';
  sessionId: string;
  /** The length ceiling cut this turn; the speaker had not stopped. */
  cutForced: boolean;
  /** Epoch ms the microphone opened on it. Real capture time, for ordering. */
  openedAt: number;
  /** Epoch ms capture finished with it. Real capture time, for the merge gap. */
  closedAt: number;
}

/**
 * A repaired, display-only rendering of one turn's source text.
 *
 * Nothing writes this yet — the producer is the display-repair phase. The shape
 * exists now so that phase adds a dispatch rather than reshaping this reducer
 * and everything that reads it.
 *
 * Display only, and deliberately kept OUT of `turns`: `TranscriptSegment.sourceText`
 * is the persisted record of what the recognizer actually produced, and it stays
 * the only thing measured. Overwriting it with a repaired string would make the
 * transcript stop being evidence of what the local engine can do.
 */
interface DisplayRepaired {
  type: 'transcript.displayRepaired';
  sessionId: string;
  text: string;
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

/**
 * Roster and attribution edits, all of them made by a person.
 *
 * Client-only for the same reason the three actions above are: no server event
 * announces them, and faking one would make the shared schema a lie about what
 * can arrive on the socket. Nothing about who is speaking crosses the wire in
 * either direction.
 *
 * There is deliberately no action that writes a `suggested` attribution. The
 * only origin reachable from here is `confirmed`, because the only thing that
 * can reach here is somebody choosing.
 */
interface SpeakerAdded {
  type: 'transcript.speakerAdded';
  /** Omitted for the default `Speaker N`. */
  label?: string;
}

interface SpeakerRenamed {
  type: 'transcript.speakerRenamed';
  speakerId: string;
  label: string;
}

interface SpeakerRemoved {
  type: 'transcript.speakerRemoved';
  speakerId: string;
}

interface TurnAttributed {
  type: 'transcript.turnAttributed';
  sessionId: string;
  speakerId: string;
}

/** Somebody said that none of the people they have named spoke this turn. */
interface TurnUnattributed {
  type: 'transcript.turnUnattributed';
  sessionId: string;
}

export type TurnKeyedAction =
  | ServerEvent
  | TranscriptReset
  | TurnAbandoned
  | LiveTextAppended
  | SpeakerAdded
  | SpeakerRenamed
  | SpeakerRemoved
  | TurnAttributed
  | TurnUnattributed
  | TurnCaptureRecorded
  | DisplayRepaired;

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

    case 'transcript.turnCaptureRecorded':
      return {
        ...state,
        captures: {
          ...state.captures,
          [event.sessionId]: {
            cutForced: event.cutForced,
            openedAt: event.openedAt,
            closedAt: event.closedAt,
          },
        },
      };

    case 'transcript.displayRepaired':
      return { ...state, displays: { ...state.displays, [event.sessionId]: event.text } };

    case 'transcript.speakerAdded': {
      const { speakers, nextNumber } = addSpeaker(
        state.speakers,
        state.nextSpeakerNumber,
        event.label,
      );
      return { ...state, speakers, nextSpeakerNumber: nextNumber };
    }

    case 'transcript.speakerRenamed':
      return {
        ...state,
        speakers: renameSpeaker(state.speakers, event.speakerId, event.label),
      };

    case 'transcript.speakerRemoved':
      // Refused when the speaker has turns; see `canRemoveSpeaker` for why
      // dropping their attributions instead would be the worse outcome.
      return {
        ...state,
        speakers: removeSpeaker(state.speakers, state.attributions, event.speakerId),
      };

    case 'transcript.turnUnattributed':
      return { ...state, attributions: unattributeTurn(state.attributions, event.sessionId) };

    case 'transcript.turnAttributed':
      return {
        ...state,
        attributions: attributeTurn(
          state.attributions,
          state.speakers,
          event.sessionId,
          event.speakerId,
        ),
      };

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

    case 'server.turn.embedding': {
      const embeddings = {
        ...state.embeddings,
        [event.sessionId]: { vector: event.vector, audioMs: event.audioMs },
      };

      // A turn somebody has already spoken for is not up for suggestion. The
      // check is here rather than in the scorer because it is a rule about
      // authority, not about similarity.
      if (state.attributions[event.sessionId]) return { ...state, embeddings };

      const suggestion = suggestSpeaker(
        buildCentroids(state.speakers, state.attributions, embeddings),
        event.vector,
      );
      if (!suggestion) return { ...state, embeddings };

      return {
        ...state,
        embeddings,
        attributions: {
          ...state.attributions,
          [event.sessionId]: {
            speakerId: suggestion.speakerId,
            origin: 'suggested',
            // Remembered so a later correction can still say what was proposed.
            // Without it there is no way to tell a suggestion somebody agreed
            // with from one nobody looked at.
            suggestedSpeakerId: suggestion.speakerId,
          },
        },
      };
    }

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
