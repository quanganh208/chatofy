'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  echoCancellationAll,
  LiveSession,
  LiveTranslateSocket,
  liveTranslateSocketUrl,
  MicrophoneGraph,
  PcmPlaybackQueue,
} from '@chatofy/realtime-client';
import type { LiveSessionStatus } from '@chatofy/realtime-client';
import type { TranslationDirection } from '@chatofy/types';
import { env } from '@/config/env';

const WORKLET_URL = '/worklets/mic-capture-processor.js';

/**
 * RMS above which a captured block counts as speech rather than room noise.
 *
 * Only drives the on-screen "translating" hint — it never gates what is sent,
 * which is the whole point of this path.
 */
const SPEECH_LEVEL = 0.02;

export interface UseLiveTranslate {
  status: LiveSessionStatus;
  /** What the model heard, growing as it hears it. */
  sourceText: string;
  /** What the model said, growing as it says it. */
  targetText: string;
  /** The language the model actually detected, when it disagrees with the direction. */
  detectedLanguage: string | null;
  /**
   * Microphone loudness, 0–1, derived from the captured blocks themselves.
   *
   * Local on purpose. The backend sends nothing at all for the first ~3.5 s of a
   * conversation — measured, the source transcript beats the audio by only
   * 280 ms and the target transcript by 57 ms, so there is no earlier server
   * signal to show. This is the only feedback available in that window, and it
   * is instant because it never leaves the machine.
   */
  level: number;
  /**
   * True while speech has been captured but nothing has come back yet.
   *
   * Names the wait rather than hiding it. The delay is the model's — around
   * 3.5 s from the start of a sentence, with a floor near 3.1 s — and no client
   * change can shorten it. Saying "translating" is honest; a spinner that
   * implies the app is stuck is not.
   */
  awaitingTranslation: boolean;
  error: string | null;
  start: (direction: TranslationDirection) => Promise<void>;
  stop: () => void;
}

/**
 * Runs a continuous conversation over `/ws/translate` in its live mode.
 *
 * A sibling of `useStreamingTranslate`, not a mode of it. The turn-based hook
 * drives `ConversationSession`, which owns a gate that decides when to listen;
 * this one has no such decision to make, because the backend has no endpoint
 * event and learns an utterance ended from trailing quiet. Every captured block
 * goes out — see the class comment on `LiveSession`.
 *
 * That difference is also why capture runs through `MicrophoneGraph` rather than
 * through `ConversationSession`: the latter couples the microphone to the gate,
 * and borrowing it would mean borrowing the gate. `MicrophoneGraph` is the same
 * microphone with no policy attached.
 */
export function useLiveTranslate(): UseLiveTranslate {
  const [status, setStatus] = useState<LiveSessionStatus>('idle');
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [awaitingTranslation, setAwaitingTranslation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<LiveSession | null>(null);
  const micRef = useRef<MicrophoneGraph | null>(null);
  const queueRef = useRef<PcmPlaybackQueue | null>(null);

  /** Release the microphone and the audio graph. Safe to call twice. */
  const teardownAudio = useCallback(() => {
    micRef.current?.close();
    micRef.current = null;
    queueRef.current = null;
  }, []);

  const start = useCallback(
    async (direction: TranslationDirection) => {
      setError(null);
      setSourceText('');
      setTargetText('');
      setDetectedLanguage(null);
      setLevel(0);
      setAwaitingTranslation(false);

      // A previous conversation may still be open. `stop()` deliberately leaves
      // its socket up so trailing translated audio still plays, and the panel
      // re-enables Start as soon as the status turns `stopped` — so pressing
      // Start again lands here while the old session is alive. Disposing it
      // first is what keeps the old session's `server.live.ended` from arriving
      // after the new one is wired and tearing down whatever `micRef` points at
      // BY THEN, which is the new microphone.
      sessionRef.current?.dispose();
      sessionRef.current = null;
      teardownAudio();

      const context = new AudioContext();
      const queue = new PcmPlaybackQueue(context);
      queueRef.current = queue;

      const mic = new MicrophoneGraph({
        openMicrophone: () =>
          navigator.mediaDevices.getUserMedia({
            // Live is the surface that already asks the user for headphones —
            // it speaks while they are still talking, through the same device
            // it is listening on. `"all"` is the only part of that cost the
            // browser can take back; see `ECHO_CANCELLATION_ALL`.
            audio: {
              echoCancellation: echoCancellationAll,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }),
        // The playback queue and the microphone share one context: closing the
        // graph has to close the queue's clock too, and two contexts would leave
        // the loudspeaker side running after teardown.
        createAudioContext: () => context,
        createWorkletNode: (ctx) => new AudioWorkletNode(ctx, 'mic-capture-processor'),
        workletUrl: WORKLET_URL,
      });
      micRef.current = mic;

      const session = new LiveSession(
        {
          createSocket: (handlers) =>
            new LiveTranslateSocket(liveTranslateSocketUrl(env.NEXT_PUBLIC_API_BASE_URL), handlers),
          // The rate travels with each chunk because it is the backend's, not
          // ours: capture is 16 kHz and this answers at 24 kHz.
          play: (samples, sampleRate) => queueRef.current?.enqueue('live', samples, sampleRate),
        },
        {
          onReady: () => setStatus('live'),
          onSourceText: (delta, lang) => {
            setAwaitingTranslation(false);
            setSourceText((text) => text + delta);
            // Surfaced rather than swallowed: the docs warn auto-detection
            // struggles with similar languages and heavy accents, and a user
            // whose speech is being read as the wrong language should be able
            // to see that rather than wonder why the output is nonsense.
            setDetectedLanguage(lang);
          },
          onTargetText: (delta) => {
            setAwaitingTranslation(false);
            setTargetText((text) => text + delta);
          },
          onEnded: () => {
            // Only the current session may tear down the shared audio graph.
            // Disposing the old one in `start()` already stops its events, so
            // this is the second lock on the same door — cheap, and the failure
            // it guards is silent: a live conversation left with no microphone
            // and a UI that says it stopped.
            if (sessionRef.current !== session) return;
            setStatus('stopped');
            setLevel(0);
            setAwaitingTranslation(false);
            teardownAudio();
          },
          onError: setError,
        },
      );
      sessionRef.current = session;

      setStatus('connecting');
      try {
        await mic.open((block, rms) => {
          session.pushBlock(block);
          setLevel(rms);
          // Loud enough to be speech rather than room noise. Only a rising edge
          // sets the flag; anything arriving from the backend clears it.
          if (rms > SPEECH_LEVEL) setAwaitingTranslation(true);
        });
        await session.start(direction);
      } catch (err) {
        setStatus('idle');
        setError(err instanceof Error ? err.message : 'Cannot start the microphone');
        session.dispose();
        teardownAudio();
      }
    },
    [teardownAudio],
  );

  const stop = useCallback(() => {
    setLevel(0);
    setAwaitingTranslation(false);
    // The microphone stops now; the socket stays open until the server says the
    // session ended, because translated audio trails the speaker by seconds.
    micRef.current?.mute();
    sessionRef.current?.stop();
    setStatus('stopped');
  }, []);

  useEffect(
    () => () => {
      sessionRef.current?.dispose();
      teardownAudio();
    },
    [teardownAudio],
  );

  return {
    status,
    sourceText,
    targetText,
    detectedLanguage,
    level,
    awaitingTranslation,
    error,
    start,
    stop,
  };
}
