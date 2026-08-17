'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SessionOptions, TranscriptSegment } from '@chatofy/types';
import {
  ConversationSession,
  TranslateSocket,
  translateSocketUrl,
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  turnKeyedTranscriptReducer,
  type ConversationStatus,
  type LiveTurn,
} from '@chatofy/realtime-client';
import { env } from '@/config/env';
import { FULL_DUPLEX_CLEARED } from '@/config/full-duplex-clearance';

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

export interface StreamingTranslateOptions {
  /**
   * Keep the microphone open while the translation plays.
   *
   * Ignored unless the build has been cleared for it — see
   * `@/config/full-duplex-clearance`, which is granted by the acoustic
   * measurement rather than by the build channel. Exists to take that
   * measurement in the first place: see `echoHeard`.
   */
  fullDuplex?: boolean;
}

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
   * Times the microphone heard our own translation playing back. Zero is what a
   * device needs to score before full duplex is worth switching on.
   */
  echoHeard: number;
  error: string | null;
  /** Live microphone level (0..1) for a meter; 0 while ignored. */
  level: number;
  /**
   * True while the microphone is deliberately ignored — i.e. while our own
   * translation is audible and this build is not cleared for full duplex.
   *
   * Speech arriving in that window is discarded, so this has to be shown: it is
   * the difference between "the app missed my sentence" and "the app told me it
   * was not listening for a moment".
   */
  muted: boolean;
  start: (options: SessionOptions) => Promise<void>;
  stop: () => void;
}

/**
 * Runs a hands-free conversation over `/ws/translate`.
 *
 * Everything with a lifetime lives in {@link ConversationSession}, which is
 * driven by a node test suite; this hook binds its callbacks to React state and
 * supplies the browser APIs it cannot fake. Anything resembling a decision about
 * when to listen belongs in `CapturePump`, and anything about resource lifetime
 * belongs in the session — not here.
 */
export function useStreamingTranslate(
  options: StreamingTranslateOptions = {},
): UseStreamingTranslate {
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
  const [muted, setMuted] = useState(false);

  // Read at each start rather than captured, so toggling the flag between runs
  // takes effect without rebuilding the session.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sessionRef = useRef<ConversationSession | null>(null);
  sessionRef.current ??= new ConversationSession(
    {
      openMicrophone: () =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            // The browser's own cleanup is free and helps the detector; it is
            // not a substitute for muting, which is what stops the loop.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
      createAudioContext: () => new AudioContext(),
      createWorkletNode: (context) => new AudioWorkletNode(context, 'mic-capture-processor'),
      createSocket: (handlers) =>
        new TranslateSocket(translateSocketUrl(env.NEXT_PUBLIC_API_BASE_URL), handlers),
      workletUrl: WORKLET_URL,
    },
    {
      onStatus: setStatus,
      onLevel: setLevel,
      onMuted: setMuted,
      onError: setError,
      onEchoHeard: () => setEchoHeard((count) => count + 1),
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
      // Dropped turns and forced-on modes must never be silent — Phase 3 reads
      // exactly these, and a demo that quietly discards a sentence looks like a
      // recogniser fault.
      onLog: (message) => console.warn(`[chatofy] ${message}`),
    },
    // Read at each start rather than captured, so toggling the flag between runs
    // takes effect without rebuilding the session.
    () => ({
      fullDuplex: FULL_DUPLEX_CLEARED && optionsRef.current.fullDuplex === true,
      // Capture no longer stops between turns. The microphone is still ignored
      // while our own translation is audible — that is `fullDuplex`, and it stays
      // off until the acoustic measurement clears this build — but it is no
      // longer shut for the whole turn cycle waiting to be re-armed.
      continuous: true,
      // Matches the extension and the server's own per-socket ceiling; higher
      // only earns `too_many_turns`.
      maxInFlight: MAX_IN_FLIGHT,
      maxUtteranceMs: MAX_UTTERANCE_MS,
    }),
  );
  const session = sessionRef.current;

  const start = useCallback((options: SessionOptions) => session.start(options), [session]);
  const stop = useCallback(() => session.stop(), [session]);

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  return {
    status,
    turns: conversation.turns,
    liveTurns: liveTurnsInOrder(conversation),
    echoHeard,
    error,
    level,
    muted,
    start,
    stop,
  };
}
