'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SessionOptions, TranscriptSegment } from '@chatofy/types';
import { TranslateSocket } from '@/clients/translate-socket';
import { ConversationSession } from '@/conversation/conversation-session';
import type { ConversationStatus } from '@/conversation/conversation-status';
import { conversationReducer, initialConversationState } from '@/state/conversation-state';

/**
 * Whether listening through playback may be switched on at all.
 *
 * A build-time constant, so the production bundle contains no path that can
 * enable it. Getting this wrong is not a bug that shows up as an error: the
 * loudspeaker feeds the microphone, the app translates its own voice, and it
 * does so in front of whoever is watching. Until the echo measurement says
 * otherwise, the only safe answer in a shipped build is no.
 */
const FULL_DUPLEX_ALLOWED = process.env.NODE_ENV !== 'production';

const WORKLET_URL = '/worklets/mic-capture-processor.js';

export interface StreamingTranslateOptions {
  /**
   * Keep the microphone open while the translation plays.
   *
   * Ignored outside development. Exists to measure whether echo cancellation
   * is good enough on a given device — see `echoHeard`.
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
   */
  liveText: string;
  /** A translation of the unfinished sentence; empty unless the turn runs long. */
  liveTranslation: string;
  /**
   * Times the microphone heard our own translation playing back. Zero is what a
   * device needs to score before full duplex is worth switching on.
   */
  echoHeard: number;
  error: string | null;
  /** Live microphone level (0..1) for a meter; 0 while ignored. */
  level: number;
  /** True while the microphone is deliberately ignored. */
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
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversationState);
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
      createSocket: (handlers) => new TranslateSocket(handlers),
      workletUrl: WORKLET_URL,
    },
    {
      onStatus: setStatus,
      onLevel: setLevel,
      onMuted: setMuted,
      onError: setError,
      onEchoHeard: () => setEchoHeard((count) => count + 1),
      onServerEvent: dispatch,
      onReset: () => dispatch({ type: 'conversation.reset' }),
    },
    () => FULL_DUPLEX_ALLOWED && optionsRef.current.fullDuplex === true,
  );
  const session = sessionRef.current;

  const start = useCallback((options: SessionOptions) => session.start(options), [session]);
  const stop = useCallback(() => session.stop(), [session]);

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  return {
    status,
    turns: conversation.turns,
    liveText: conversation.liveText,
    liveTranslation: conversation.liveTranslation,
    echoHeard,
    error,
    level,
    muted,
    start,
    stop,
  };
}
