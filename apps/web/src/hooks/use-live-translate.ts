'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LiveSession,
  LiveTranslateSocket,
  liveTranslateSocketUrl,
  PcmPlaybackQueue,
  downsampleToPcm16,
  pcm16Rms,
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
 * That difference is also why the microphone is wired here rather than reused:
 * `ConversationSession` couples the microphone to the gate, and borrowing it
 * would mean borrowing the gate.
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
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const queueRef = useRef<PcmPlaybackQueue | null>(null);

  /** Release the microphone and the audio graph. Safe to call twice. */
  const teardownAudio = useCallback(() => {
    if (nodeRef.current) nodeRef.current.port.onmessage = null;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
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

      const context = new AudioContext();
      contextRef.current = context;
      const queue = new PcmPlaybackQueue(context);
      queueRef.current = queue;

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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        await context.audioWorklet.addModule(WORKLET_URL);
        const node = new AudioWorkletNode(context, 'mic-capture-processor');
        nodeRef.current = node;
        // Unconditional. A filter here would be the gate this path must not have.
        node.port.onmessage = (message: MessageEvent<Float32Array>) => {
          const block = downsampleToPcm16(message.data, context.sampleRate);
          session.pushBlock(block);
          // Read off the block already in hand rather than tapping the graph a
          // second time: an AnalyserNode would measure the same samples again.
          const rms = pcm16Rms(block);
          setLevel(rms);
          // Loud enough to be speech rather than room noise. Only a rising edge
          // sets the flag; anything arriving from the backend clears it.
          if (rms > SPEECH_LEVEL) setAwaitingTranslation(true);
        };
        context.createMediaStreamSource(stream).connect(node);
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
    if (nodeRef.current) nodeRef.current.port.onmessage = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
