import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  addSpeaker,
  attributeTurn,
  autoAttributeTurn,
  fillPendingTurns,
  isHumanTouched,
  markPending,
  removeSpeaker,
  renameSpeaker,
  unattributeTurn,
  type AttributionsBySession,
  type SessionSpeaker,
} from './speaker-roster.js';
import type { EmbeddingsBySession } from './speaker-centroids.js';
import {
  DEFAULT_AUTO_ATTRIBUTION,
  EMPTY_AUTO_ATTRIBUTION,
  observeVoice,
  type AutoAttributionState,
} from './auto-attribution.js';

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
   * Kept per turn rather than folded away, because the settle pass needs to
   * re-score a turn the clusterer could not place at the time — by then the
   * voices it is compared against have heard the whole conversation. Same reason
   * the statistics are derived rather than counted: a total kept alongside the
   * turns can disagree with them, and neither one is then trustworthy. They live
   * and die with everything else here.
   */
  embeddings: EmbeddingsBySession;
  /**
   * The voices the acoustic layer has discovered on its own, in discovery order.
   *
   * Held beside `speakers` rather than inside it because the two answer
   * different questions and have different lifetimes. `speakers` is the roster a
   * person sees and may rename; this is the running acoustic model, and it is
   * meaningless outside the conversation that built it.
   */
  autoAttribution: AutoAttributionState;
  /**
   * Roster id per discovered voice, index-aligned with
   * `autoAttribution.clusters`.
   *
   * The clusterer names voices by position and knows nothing about the roster;
   * a person may have added speakers of their own before it ever ran. This is
   * the join, and keeping it explicit is what stops cluster 0 from being assumed
   * to be `speakers[0]`.
   */
  autoSpeakerIds: string[];
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
   * Turns whose translation was never spoken, keyed by the server's `sessionId`.
   *
   * "No sentence is lost" is bounded, and this is where the bound becomes
   * visible. `OrderedPlayback` drops the oldest waiting turn once the queue
   * passes its 12s ceiling, and releases one the stall watchdog gave up on —
   * both reach the reducer as `transcript.turnAbandoned`, and until this existed
   * both were indistinguishable from a turn that played normally. Nothing on
   * screen said a sentence had gone unheard.
   *
   * It matters more since the speed presets opened below 1.0x: slower speech
   * outlasts the cadence turns arrive at, so under continuous speech the drop is
   * no longer a tail event but the expected outcome, and choosing that rate has
   * to be a visible trade rather than a silent one.
   *
   * Keyed rather than folded into the segment for the same reason as `captures`:
   * it arrives separately, sometimes for a turn whose text never arrived at all.
   * That case marks nothing — there is no row to mark — and is the honest limit
   * of this signal.
   */
  unheard: UnheardBySession;
  /**
   * Typeset display text per turn, keyed by the server's `sessionId`.
   *
   * Read as `displays[sessionId] ?? segment.sourceText`. Written from
   * `server.transcript.final`'s optional `display` field, in the SAME update
   * that appends the turn — so a line arrives already typeset and never visibly
   * changes. It previously came as its own event tens of seconds later, which is
   * the behaviour this replaced.
   *
   * **An entry exists only when the rendering differs from the recognizer's
   * text**, and rendering treats presence as exactly that claim: it is what
   * decides whether a turn shows a "show original" disclosure. Writing an entry
   * for every turn would put that disclosure under every line with the original
   * identical to the text above it.
   *
   * A turn without one shows its raw text, which is what makes the fallback
   * load-bearing rather than defensive.
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

/**
 * Why a turn's audio was never heard.
 *
 * The two abandon reasons that mean audio existed: `backlog` is the playback
 * queue past its ceiling dropping the oldest waiting turn, `stalled` is the
 * watchdog releasing one that never finished arriving. Named as a union rather
 * than taken as any string so that adding a third reason upstream is a type
 * error here instead of a marker that quietly stops appearing.
 */
export type UnheardReason = 'backlog' | 'stalled';

export type UnheardBySession = Record<string, UnheardReason>;

const UNHEARD_REASONS = new Set<string>(['backlog', 'stalled'] satisfies UnheardReason[]);

export const initialTurnKeyedTranscript: TurnKeyedTranscript = {
  turns: [],
  live: {},
  speakers: [],
  attributions: {},
  nextSpeakerNumber: 1,
  embeddings: {},
  autoAttribution: EMPTY_AUTO_ATTRIBUTION,
  autoSpeakerIds: [],
  captures: {},
  unheard: {},
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
  /**
   * Why it ended, as `ConversationSession` reports it.
   *
   * Optional so a caller that only wants the live line cleaned up still
   * compiles, and read here for one purpose: `backlog` and `stalled` are the
   * two reasons the turn's AUDIO existed and was never played. Everything else
   * ends a turn that had nothing to hear.
   */
  reason?: string;
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

/**
 * The conversation is over; pay what the acoustic layer still owes.
 *
 * Client-side like {@link TranscriptReset}, and for the same reason: no server
 * event announces it. The socket closing IS the signal, and the server cannot
 * send anything after it.
 *
 * Distinct from a reset, which throws the conversation away. This is the last
 * thing that happens while it still exists — every turn left `pending` gets an
 * ordinal here, because a chip that never resolves to a person is the one
 * outcome this design treats as a failure.
 *
 * Idempotent: a second dispatch finds nothing pending and changes nothing.
 */
interface TranscriptSettled {
  type: 'transcript.settled';
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
  | TranscriptSettled;

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

    case 'transcript.turnAbandoned': {
      const cleared = withoutLive(state, event.sessionId);
      // Recorded even where there was no live line to clear — by the time the
      // playback queue drops a turn its text has usually already landed in
      // `turns`, which is precisely the row this marks.
      if (!event.sessionId || !event.reason || !UNHEARD_REASONS.has(event.reason)) return cleared;
      return {
        ...cleared,
        unheard: { ...cleared.unheard, [event.sessionId]: event.reason as UnheardReason },
      };
    }

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

    case 'server.transcript.display':
      // LEGACY. The server no longer emits this — the rendering rides on
      // `server.transcript.final` instead, so it lands in the same update as its
      // turn and the line never visibly changes. Handled anyway, because this
      // client may be talking to a server that has not been deployed yet, and
      // dropping the case would lose a display rather than merely delay one.
      //
      // Kept OUT of `turns`, and that is the whole rule. `TranscriptSegment.sourceText`
      // is the persisted record of what the recognizer actually produced and stays
      // the only thing measured; overwriting it with a repaired string would make the
      // transcript stop being evidence of what the local engine can do.
      //
      // Stored by `sessionId` with no check that the turn has arrived. It normally
      // has — the server sends this only after that turn's final — but a repair for
      // an unknown turn is harmless: rendering reads `displays[sessionId]` per turn,
      // so an orphan entry is simply never looked at. Refusing it here would instead
      // lose a repair to any ordering the transport does not actually guarantee.
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

      // A turn a person has already decided is not up for the machine — and
      // that includes one they put back to *nobody said this*, which is not
      // rendered but is very much decided. `autoAttributeTurn` refuses these
      // too; the check is repeated here so the clusterer is not fed a vector
      // whose label was never in question.
      //
      // **A deliberate divergence from `online.py`, named because it is one.**
      // The reference observes every turn, so a human-labelled turn would still
      // move a centroid. It cannot here, and the reason is that the reference
      // has no human labels: `observeVoice` folds a vector into whichever
      // cluster it scores nearest, which is precisely the cluster a person may
      // have just said it does NOT belong to. Folding it would teach the model
      // the opposite of the correction.
      //
      // The cost is real and worth stating: the best evidence in the system —
      // a turn somebody vouched for — contributes nothing to any profile. What
      // it would take to use it is a seeded fold that respects the human's
      // choice of cluster (`online.py`'s `seed`), which is a design with its
      // own failure modes and belongs to its own measured slice, not to a
      // comment here.
      const settledByHand = state.attributions[event.sessionId];
      if (settledByHand && isHumanTouched(settledByHand)) {
        return { ...state, embeddings };
      }

      // Already heard. A re-delivered embedding must not fold the same turn
      // into a centroid twice: the reference implementation observes each turn
      // once, and a doubled fold moves the profile the NEXT turn is compared
      // against without changing anything visible.
      if (state.embeddings[event.sessionId]) return { ...state, embeddings };

      const observed = observeVoice(state.autoAttribution, event.vector, DEFAULT_AUTO_ATTRIBUTION);

      // Held, not lost: the turn is owed an ordinal and `transcript.settled` is
      // what pays it. Reached from the dead zone, and from every refusal below.
      const held = (autoAttribution: AutoAttributionState): TurnKeyedTranscript => ({
        ...state,
        embeddings,
        autoAttribution,
        attributions: markPending(state.attributions, event.sessionId),
      });

      if (observed.assignment.index === null) return held(observed.state);

      // A minted voice needs a roster entry before anything can point at it.
      // `addSpeaker` is reused rather than reimplemented so an automatic
      // participant is indistinguishable from one somebody typed — the same
      // label, the same id scheme, the same rename and remove rules.
      let speakers = state.speakers;
      let nextSpeakerNumber = state.nextSpeakerNumber;
      let autoSpeakerIds = state.autoSpeakerIds;
      if (observed.assignment.created) {
        const added = addSpeaker(speakers, nextSpeakerNumber);
        // `addSpeaker` refuses past MAX_SPEAKERS and returns the roster
        // unchanged. **Keep the OLD cluster state when it does.** Committing the
        // new one would leave a cluster with no roster id behind it, and since
        // the index into `autoSpeakerIds` is positional, every later voice would
        // read the wrong id or none — a session that wedges and never recovers,
        // with every chip unresolved at the end.
        if (added.speakers.length === speakers.length) return held(state.autoAttribution);
        speakers = added.speakers;
        nextSpeakerNumber = added.nextNumber;
        autoSpeakerIds = [...autoSpeakerIds, speakers[speakers.length - 1]!.id];
      }

      const speakerId = autoSpeakerIds[observed.assignment.index];
      // The voice is known but its roster entry is gone — somebody removed an
      // automatic speaker. Hold the turn rather than dropping it: attributing to
      // a speaker who is not on the roster renders as nothing at all, and would
      // do it with no error to notice.
      if (!speakerId || !speakers.some((speaker) => speaker.id === speakerId)) {
        return held(observed.state);
      }

      return {
        ...state,
        embeddings,
        autoAttribution: observed.state,
        autoSpeakerIds,
        speakers,
        nextSpeakerNumber,
        attributions: autoAttributeTurn(state.attributions, speakers, event.sessionId, speakerId),
      };
    }

    case 'transcript.settled': {
      // Nothing was heard, so nothing is owed.
      //
      // `observeVoice` mints a cluster from the very first vector it is given,
      // so an empty cluster list means the acoustic layer never ran at all —
      // which is the DEFAULT: `SPEAKER_EMBEDDING_ENABLED` is off, the server
      // sends no vectors, and no turn ever reaches `pending`. Settling anyway
      // sent every human-untouched turn through the carry-forward below, so one
      // confirmed turn put that person's name on every turn after it, with the
      // feature switched off. A turn nobody attributed must never render as a
      // person; this is the guard that keeps the promise from inventing one.
      if (state.autoAttribution.clusters.length === 0) return state;

      // The promise `pending` makes, kept. Every turn still waiting takes the
      // nearest voice its own vector points at; a turn whose vector never
      // arrived — the last few of every session, lost when the socket closed
      // before the server could emit — has nothing to point at and inherits from
      // the turn before it instead.
      //
      // `turns` is walked in order rather than the attribution map, because the
      // inheritance is positional and object key order is not a transcript.
      const order = state.turns.map((turn) => turn.sessionId);
      const attributions = fillPendingTurns(state.attributions, order, (sessionId) => {
        const embedding = state.embeddings[sessionId];
        if (!embedding) return null;
        const { assignment } = observeVoice(
          state.autoAttribution,
          embedding.vector,
          DEFAULT_AUTO_ATTRIBUTION,
        );
        if (assignment.nearest === null) return null;
        const speakerId = state.autoSpeakerIds[assignment.nearest];
        // A voice whose roster entry was removed cannot be pointed at, so this
        // turn falls through to the carry-forward instead.
        if (!speakerId || !state.speakers.some((speaker) => speaker.id === speakerId)) return null;
        return speakerId;
      });
      // Idempotent by identity, not just by value: a second stop must not
      // re-render the whole transcript for no change.
      if (attributions === state.attributions) return state;
      return { ...state, attributions };
    }

    case 'server.transcript.final': {
      // The live lines and the finished turn are the same sentence, so keeping
      // both would show it twice. Only THIS turn's lines go — the crucial
      // difference from the single-turn reducer, which clears the conversation's
      // one live line and so wipes a sentence someone is still speaking.
      const cleared = withoutLive(state, event.sessionId);
      // The typeset rendering rides on this event, so the turn and its display
      // land in ONE state update and therefore one render. Arriving as a second
      // event meant a frame in which the words-form was on screen.
      const displays =
        event.display === undefined
          ? cleared.displays
          : { ...cleared.displays, [event.sessionId]: event.display };
      return { ...cleared, turns: [...cleared.turns, event.segment], displays };
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
