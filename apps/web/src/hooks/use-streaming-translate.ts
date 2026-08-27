'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SessionOptions, TranscriptSegment } from '@chatofy/types';
import {
  ConversationSession,
  PcmPlaybackQueue,
  TranslateSocket,
  translateSocketUrl,
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  turnKeyedTranscriptReducer,
  attributionStats,
  type AttributionsBySession,
  type AttributionStats,
  type CapturesBySession,
  type ConversationStatus,
  type LiveTurn,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import { useAccessToken } from '@/hooks/use-access-token';
import { useAuthRecovery } from '@/hooks/use-auth-recovery';
import { useTranslate } from '@/i18n/provider';
import { openMicrophone } from '@/lib/open-microphone';
import { env } from '@/config/env';

const WORKLET_URL = '/worklets/mic-capture-processor.js';

/** Turns this page will have open at the server at once. */
const MAX_IN_FLIGHT = 3;

/**
 * Longest a single turn may run before it is cut.
 *
 * Continuous capture needs one: in a real conversation people speak for tens of
 * seconds without ever leaving a full hangover of silence, so a gate that only
 * ends turns on silence would open one turn and never close it. 8s matches the
 * extension, which has run this configuration on real calls.
 *
 * It has a measurement consequence worth stating where the value is set: it
 * RIGHT-CENSORS the turn-length distribution, so "how many turns run past N
 * seconds" is partly a property of this constant. Anything reading that
 * distribution has to report the ceiling beside it and treat `cutForced` turns
 * as censored rather than as observations.
 */
const MAX_UTTERANCE_MS = 8_000;

/**
 * Playback gain never exceeds unity.
 *
 * Above 1 the samples clip, and it raises the loudspeaker level feeding the
 * microphone — which is the loop `fullDuplex: true` below deliberately accepts the
 * risk of. Boosting is not worth making that loop more likely to close.
 */
const clampVolume = (volume: number): number => Math.min(1, Math.max(0, volume));

export interface UseStreamingTranslate {
  status: ConversationStatus;
  /** Finished turns, newest last. */
  turns: TranscriptSegment[];
  /**
   * What the speaker is saying right now, as far as the recogniser has heard.
   * Empty between turns.
   *
   * One entry per turn still being spoken. A list rather than a single line
   * because capture no longer waits: with several turns in flight, one live line
   * for the conversation is overwritten by whichever turn's partial arrived last,
   * so the text flickers between two sentences and the first turn to finish wipes
   * a line someone is still speaking.
   */
  liveTurns: (LiveTurn & { sessionId: string })[];
  /**
   * Who is in this conversation, and who said each finished turn.
   *
   * Both come from the same reducer the transcript does, and they leave with it
   * — the session's own unmount cleanup is the whole of the guarantee that no
   * voice label outlives the conversation. A component that kept its own copy
   * in `useState` would be a second source of truth for what is on screen, and
   * the one that survived would be the wrong one.
   */
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  /**
   * What capture measured about each finished turn, keyed by `sessionId`.
   *
   * The transcript joins this to the turns at render time so one utterance the
   * length ceiling split into several turns reads as one block.
   */
  captures: CapturesBySession;
  /** Repaired source text per turn, where a repair exists. Falls back to raw. */
  displays: Record<string, string>;
  /** How the labelling went, for reading back after a conversation. */
  stats: AttributionStats;
  /** Add a participant. Without a label they get a numbered one in the reader's language. */
  addSpeaker: (label?: string) => void;
  renameSpeaker: (speakerId: string, label: string) => void;
  /** Refused while the speaker has turns; see `canRemoveSpeaker`. */
  removeSpeaker: (speakerId: string) => void;
  attributeTurn: (sessionId: string, speakerId: string) => void;
  /** Say that none of the named people spoke this turn. */
  unattributeTurn: (sessionId: string) => void;
  /**
   * Times speech was confirmed while our own translation was playing.
   *
   * The only trace an acoustic loop leaves, and the reason the build-time
   * full-duplex flag could be removed — but it is NOT a count of echo, and this
   * page must not present it as one. The microphone is honoured throughout
   * playback here, so someone talking over the translation confirms this gate
   * exactly as our own loudspeaker would; barge-in is the feature, not a fault,
   * and nothing at this level separates the two. Room noise lands here as well.
   *
   * So: non-zero means "something was said while our audio was out", and what
   * settles which is the transcript — an acoustic loop fills it with the app's
   * own voice, unmistakably. Read `CapturePumpHandlers.onEchoHeard` in
   * `@chatofy/realtime-client` before quoting this number in a measurement.
   */
  echoHeard: number;
  error: string | null;
  /** Live microphone level (0..1) for a meter. */
  level: number;
  start: (options: SessionOptions) => Promise<void>;
  stop: () => void;
  /**
   * Set playback gain, 0..1, taking effect immediately.
   *
   * Live mid-conversation because it never touches the session options: the gain
   * node sits between the playback queue and the loudspeakers, so changing it is
   * a property write rather than anything the server has to be told about.
   */
  setVolume: (volume: number) => void;
}

/**
 * Runs a hands-free conversation over `/ws/translate`.
 *
 * Everything with a lifetime lives in {@link ConversationSession}, which is
 * driven by a node test suite; this hook binds its callbacks to React state and
 * supplies the browser APIs it cannot fake. Anything resembling a decision about
 * when to listen belongs in `CapturePump`, and anything about resource lifetime
 * belongs in the session — not here.
 *
 * `getVolume` is a READER for the same reason `token` below is one: the session is
 * built once, on first render, which happens before the settings have been read
 * out of storage. A volume captured by value there would be the first-render
 * default for the lifetime of the page, and the volume someone actually saved
 * would silently never apply.
 */
export function useStreamingTranslate(getVolume: () => number = () => 1): UseStreamingTranslate {
  // A READER, not a value. The socket cannot open without a token —
  // /ws/translate refuses an unauthenticated upgrade before any socket exists —
  // and the session resolves asynchronously, after this hook's first render.
  // The transport below is built once, so a captured value would be the empty
  // first-render one forever. This is called at connect time instead.
  const token = useAccessToken();
  const recovery = useAuthRecovery(token);
  const [status, setStatus] = useState<ConversationStatus>('idle');
  // What is on screen is derived from the server's events by a reducer that can
  // be tested on its own; this hook only carries transport.
  const [conversation, dispatch] = useReducer(
    turnKeyedTranscriptReducer,
    initialTurnKeyedTranscript,
  );
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [echoHeard, setEchoHeard] = useState(0);

  /**
   * The gain stage the translated audio passes through, for the run in progress.
   *
   * Stale-tolerant by design: the session can stop itself (a dropped socket calls
   * its own `stop`), and `releaseResources` closes the AudioContext without
   * telling anyone outside. `onStopped` below nulls this, and `setVolume` checks
   * the context is still open, so a node belonging to a finished run is simply
   * ignored rather than being an error case to prevent.
   */
  const gainRef = useRef<GainNode | null>(null);
  // Read at sink-creation time. See the note on `getVolume` above.
  //
  // Kept current in an effect rather than assigned during render: a render can be
  // discarded or replayed, so writing a ref in one is a side effect at a moment
  // React does not promise anything about. The seeded value covers the window
  // before the first commit, and a session cannot start inside it — `start` is
  // triggered by a click.
  const getVolumeRef = useRef(getVolume);
  useEffect(() => {
    getVolumeRef.current = getVolume;
  }, [getVolume]);

  // Same treatment, and for the same reason: the session below is built once, so a
  // captured translator would be the one from the first render forever.
  const t = useTranslate();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const sessionRef = useRef<ConversationSession | null>(null);
  sessionRef.current ??= new ConversationSession(
    {
      // Through the helper, which classifies the rejection and throws a sentence from
      // the dictionary. `ConversationSession` reports a failed start as `err.message`
      // and has no dictionary of its own — it is shared with the extension — so the
      // message has to arrive already translated for `error` below to be readable.
      openMicrophone: () => openMicrophone(tRef.current),
      createAudioContext: () => new AudioContext(),
      createWorkletNode: (context) => new AudioWorkletNode(context, 'mic-capture-processor'),
      createSocket: (handlers) =>
        new TranslateSocket(
          translateSocketUrl(env.NEXT_PUBLIC_API_BASE_URL),
          handlers,
          // Read HERE, when the socket is actually opened.
          token.current(),
        ),
      workletUrl: WORKLET_URL,
      /**
       * Playback, with a gain stage in front of the loudspeakers.
       *
       * The node is built HERE, once per run, and never cached across runs: each
       * start gets a fresh `AudioContext` (see `createAudioContext` above) and
       * `releaseResources` closes the previous one. Connecting a new run's
       * sources to a node from a closed context throws a cross-context
       * `InvalidAccessError`, and audio would die on the second conversation.
       *
       * Deliberately NOT a gain stage inside `PcmPlaybackQueue`: the extension
       * gives that class a sink that feeds the MEETING's outgoing track, where
       * attenuating "playback volume" would quietly turn down what the other
       * participants hear.
       */
      createPlaybackSink: (context, onTurnDrained) => {
        const gain = context.createGain();
        gain.gain.value = clampVolume(getVolumeRef.current());
        gain.connect(context.destination);
        gainRef.current = gain;
        return new PcmPlaybackQueue(context, onTurnDrained, gain);
      },
    },
    {
      onStatus: setStatus,
      onLevel: setLevel,
      // Nothing left to report. The microphone is honoured throughout playback
      // now, and the pump raises this only when it is ignoring input, so on this
      // page the edge cannot fire — see `fullDuplex` below. Required by the
      // session because the extension and the single-turn path both use it.
      onMuted: () => {},
      // Every connection failure asks whether the session is still valid before
      // it is reported as a fault. Without this an expired token reads as the
      // API being down, and the user retries into a refusal forever — there is
      // no refresh flow, so signing in again is the only way out.
      onError: (message) => {
        setError(message);
        void recovery.handleConnectionFailure();
      },
      onEchoHeard: () => setEchoHeard((count) => count + 1),
      // The only teardown signal that reaches outside the session. `stop()` is not
      // enough on its own: a dropped socket makes the session stop ITSELF, and
      // `releaseResources` is private with no callback, so without this the gain
      // node of a closed context would be held until the next run replaced it.
      onStopped: () => {
        gainRef.current = null;
      },
      onServerEvent: dispatch,
      onReset: () => dispatch({ type: 'transcript.reset' }),
      // Not optional once turns run concurrently. A turn refused at a ceiling,
      // dropped from the playback backlog, or released by the stall watchdog
      // produces no `server.session.ended`, so without this its live line stays
      // on screen for the rest of the conversation.
      onTurnAbandoned: (sessionId) =>
        dispatch({
          type: 'transcript.turnAbandoned',
          sessionId: sessionId ?? undefined,
        }),
      // What capture measured, which the server cannot know: whether the length
      // ceiling cut the turn, and when the microphone opened and closed on it.
      // The transcript needs all three to show one ceiling-cut utterance as one
      // block instead of asking who spoke two or three times about one sentence.
      // Arrives after that turn's `server.transcript.final`, so the reducer
      // keys it separately and rendering joins the two.
      onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt }) =>
        dispatch({
          type: 'transcript.turnCaptureRecorded',
          sessionId,
          cutForced,
          openedAt,
          closedAt,
        }),
      // Dropped turns and forced-on modes must never be silent — Phase 3 reads
      // exactly these, and a demo that quietly discards a sentence looks like a
      // recogniser fault.
      onLog: (message) => console.warn(`[chatofy] ${message}`),
    },
    () => ({
      // The microphone is honoured while our own translation plays, so someone
      // may talk over it and be heard. What this costs is an acoustic loop —
      // loudspeaker into microphone, and the app translates its own voice — and
      // whether that loop closes is a property of the device, not of the code.
      // Switched on for the laptop this is developed and demonstrated on, whose
      // built-in cancellation holds: playback was verified never to reopen the
      // gate while someone was speaking. `echoHeard` is what says otherwise on a
      // machine where it does not hold, and it is on screen the moment it moves.
      fullDuplex: true,
      // Capture does not stop between turns either: the microphone is no longer
      // shut for the whole turn cycle waiting to be re-armed.
      continuous: true,
      // Matches the extension and the server's own per-socket ceiling; higher
      // only earns `too_many_turns`.
      maxInFlight: MAX_IN_FLIGHT,
      maxUtteranceMs: MAX_UTTERANCE_MS,
      // Per-turn rows for the JSONL sink. The turn-length distribution and the
      // request-per-model rate are computed from these, and both are client
      // facts: the server cannot know when someone began speaking, nor when a
      // loudspeaker produced sound. Always sent; where they land is the server's
      // decision, and with no `TURN_METRICS_PATH` set it drops them.
      reportMetrics: true,
    }),
  );
  const session = sessionRef.current;

  const start = useCallback((options: SessionOptions) => session.start(options), [session]);
  const stop = useCallback(() => session.stop(), [session]);

  const setVolume = useCallback((volume: number) => {
    const gain = gainRef.current;
    // Nothing to write to when no conversation is running — the value still lives
    // in settings, and the next sink reads it through `getVolume`. A closed
    // context is the same case: the run it belonged to is over.
    if (!gain || gain.context.state === 'closed') return;
    // Ramped rather than assigned. A step change in gain is an audible click,
    // which on a control someone is dragging would fire on every frame.
    gain.gain.setTargetAtTime(clampVolume(volume), gain.context.currentTime, 0.01);
  }, []);

  // Every speaker edit goes through the same dispatch the socket's events do.
  //
  // The placeholder name is written HERE rather than in the reducer's own
  // fallback: `@chatofy/realtime-client` ships to the extension too and holds no
  // dictionary, so a default it wrote would be English on a Vietnamese page. The
  // number still comes from the roster's counter, which is what keeps a name from
  // colliding with a live one after a removal.
  const addSpeaker = useCallback(
    (label?: string) =>
      dispatch({
        type: 'transcript.speakerAdded',
        label:
          label ?? t('web.translate.speakerDefault', { number: conversation.nextSpeakerNumber }),
      }),
    [t, conversation.nextSpeakerNumber],
  );
  const renameSpeaker = useCallback(
    (speakerId: string, label: string) =>
      dispatch({ type: 'transcript.speakerRenamed', speakerId, label }),
    [],
  );
  const removeSpeaker = useCallback(
    (speakerId: string) => dispatch({ type: 'transcript.speakerRemoved', speakerId }),
    [],
  );
  const attributeTurn = useCallback(
    (sessionId: string, speakerId: string) =>
      dispatch({ type: 'transcript.turnAttributed', sessionId, speakerId }),
    [],
  );
  const unattributeTurn = useCallback(
    (sessionId: string) => dispatch({ type: 'transcript.turnUnattributed', sessionId }),
    [],
  );

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  return {
    status,
    turns: conversation.turns,
    liveTurns: liveTurnsInOrder(conversation),
    captures: conversation.captures,
    displays: conversation.displays,
    speakers: conversation.speakers,
    attributions: conversation.attributions,
    stats: attributionStats(conversation),
    addSpeaker,
    renameSpeaker,
    removeSpeaker,
    attributeTurn,
    unattributeTurn,
    echoHeard,
    error,
    level,
    start,
    stop,
    setVolume,
  };
}
