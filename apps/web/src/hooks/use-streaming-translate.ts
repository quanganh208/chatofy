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
import { useAccessToken } from '@/hooks/use-access-token';
import { useAuthRecovery } from '@/hooks/use-auth-recovery';
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
export function useStreamingTranslate(): UseStreamingTranslate {
  // The socket cannot open without it: /ws/translate refuses an unauthenticated
  // upgrade before any socket exists. Read from the session rather than stored,
  // so signing out takes effect on the next connect.
  const accessToken = useAccessToken();
  const recovery = useAuthRecovery(accessToken);
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
        new TranslateSocket(
          translateSocketUrl(env.NEXT_PUBLIC_API_BASE_URL),
          handlers,
          accessToken,
        ),
      workletUrl: WORKLET_URL,
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

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  return {
    status,
    turns: conversation.turns,
    liveTurns: liveTurnsInOrder(conversation),
    echoHeard,
    error,
    level,
    start,
    stop,
  };
}
