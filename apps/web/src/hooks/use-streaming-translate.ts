'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ServerEvent, TranscriptSegment, TranslationDirection } from '@chatofy/types';
import { TranslateSocket } from '@/clients/translate-socket';
import { CapturePump } from '@/audio/capture-pump';
import { PcmPlaybackQueue } from '@/audio/pcm-playback-queue';
import {
  base64ToPcm16,
  downsampleToPcm16,
  pcm16ToBase64,
  TARGET_SAMPLE_RATE,
} from '@/audio/pcm-resampler';
import { conversationReducer, initialConversationState } from '@/state/conversation-state';

/**
 * What the user is currently doing, or having done for them.
 *
 * Part of the hook's exported contract (`UseStreamingTranslate.status`).
 * @public
 */
export type ConversationStatus =
  'idle' | 'connecting' | 'listening' | 'hearing-speech' | 'translating' | 'playing';

/** Samples the worklet posts per block, at the audio context's own rate. */
const WORKLET_BLOCK_SAMPLES = 1024;

/** How often the level meter may update. ~10 Hz instead of ~47. */
const LEVEL_UPDATE_MS = 100;

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
  start: (direction: TranslationDirection) => Promise<void>;
  stop: () => void;
}

/**
 * Runs a hands-free conversation over `/ws/translate`.
 *
 * The turn boundary is decided by {@link CapturePump}, which owns the whole
 * policy and is unit-tested; this hook is the wiring between it, the socket and
 * playback. Anything resembling a decision about when to listen belongs there,
 * not here.
 *
 * The one invariant worth restating: the microphone is re-armed only once the
 * turn has BOTH ended server-side AND finished playing. Releasing on either
 * alone reopens it into our own loudspeaker, and two people sharing one phone
 * then get a loop where the app translates itself forever.
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

  const socketRef = useRef<TranslateSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackRef = useRef<PcmPlaybackQueue | null>(null);
  const pumpRef = useRef<CapturePump | null>(null);

  const directionRef = useRef<TranslationDirection>('vi_to_en');
  /** Server-assigned id for the turn in flight; null between turns. */
  const sessionIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  /** Blocks captured before `server.session.ready` arrived. */
  const pendingRef = useRef<Int16Array[]>([]);
  /** Set when the server closes the turn; half of the re-arm condition. */
  const turnEndedRef = useRef(false);
  /**
   * Identifies the current `start()` run. `stop()` bumps it so a start still
   * awaiting `getUserMedia` abandons the microphone it is about to be handed
   * instead of publishing it to refs the caller believes are torn down.
   */
  const runIdRef = useRef(0);
  const lastLevelAtRef = useRef(0);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
    nodeRef.current?.disconnect();
    if (nodeRef.current) nodeRef.current.port.onmessage = null;
    nodeRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    pumpRef.current?.reset();
    pumpRef.current = null;
    sessionIdRef.current = null;
    sequenceRef.current = 0;
    pendingRef.current = [];
    turnEndedRef.current = false;
    setStatus('idle');
    setLevel(0);
    setMuted(false);
  }, []);

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  /**
   * Listen again, but only when the turn is finished in both senses. Called
   * from the server's end-of-turn and from playback draining, because either
   * can be the last to happen.
   */
  const armNextTurnIfDone = useCallback(() => {
    if (!turnEndedRef.current) return;
    if (playbackRef.current?.isPlaying) return;
    turnEndedRef.current = false;
    pumpRef.current?.armNextTurn();
    setMuted(false);
    setStatus('listening');
  }, []);

  const sendBlock = useCallback((block: Int16Array) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      // The handshake is still in flight; hold the audio rather than drop it.
      pendingRef.current.push(block);
      return;
    }
    socketRef.current?.sendAudio(
      sessionId,
      sequenceRef.current++,
      TARGET_SAMPLE_RATE,
      pcm16ToBase64(block),
    );
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      // Every event goes to the reducer; the switch below is transport and
      // playback, which the reducer deliberately knows nothing about.
      dispatch(event);

      switch (event.type) {
        case 'server.session.ready': {
          sessionIdRef.current = event.sessionId;
          const held = pendingRef.current;
          pendingRef.current = [];
          for (const block of held) {
            socketRef.current?.sendAudio(
              event.sessionId,
              sequenceRef.current++,
              TARGET_SAMPLE_RATE,
              pcm16ToBase64(block),
            );
          }
          break;
        }

        case 'server.audio.frame':
          setStatus('playing');
          playbackRef.current?.enqueue(base64ToPcm16(event.frame.payload), event.frame.sampleRate);
          break;

        case 'server.session.ended':
          sessionIdRef.current = null;
          sequenceRef.current = 0;
          turnEndedRef.current = true;
          // Usually a no-op: audio is still playing, and the microphone must
          // stay shut until it has drained.
          armNextTurnIfDone();
          break;

        case 'server.error':
          setError(event.message);
          break;

        default:
          break;
      }
    },
    [armNextTurnIfDone],
  );

  const start = useCallback(
    async (direction: TranslationDirection) => {
      if (contextRef.current) return; // already running
      const runId = ++runIdRef.current;
      const isStale = () => runIdRef.current !== runId;

      setError(null);
      dispatch({ type: 'conversation.reset' });
      setStatus('connecting');
      directionRef.current = direction;

      // Held locally until every await has cleared, so a teardown mid-startup
      // releases them instead of leaking a live microphone.
      let stream: MediaStream | undefined;
      let context: AudioContext | undefined;
      let socket: TranslateSocket | undefined;
      const abandon = () => {
        socket?.close();
        stream?.getTracks().forEach((track) => track.stop());
        void context?.close().catch(() => {});
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // The browser's own cleanup is free and helps the detector; it is
            // not a substitute for muting, which is what stops the loop.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (isStale()) return abandon();

        context = new AudioContext();
        await context.audioWorklet.addModule('/worklets/mic-capture-processor.js');
        if (isStale()) return abandon();

        socket = new TranslateSocket({
          onEvent: handleServerEvent,
          onError: setError,
          onClosed: () => {
            // Without a socket the conversation cannot continue, and leaving it
            // "listening" would strand the microphone muted mid-turn.
            setError('Connection to the translator dropped');
            stop();
          },
        });
        await socket.connect();
        if (isStale()) return abandon();

        const activeSocket = socket;
        const activeContext = context;

        const playback = new PcmPlaybackQueue(context, armNextTurnIfDone);
        const pump = new CapturePump(
          {
            onTurnOpen: (preRoll) => {
              setStatus('hearing-speech');
              sequenceRef.current = 0;
              sessionIdRef.current = null;
              pendingRef.current = [...preRoll];
              activeSocket.startSession(directionRef.current);
            },
            onAudio: sendBlock,
            // A suspected pause: let the server get a head start on the text.
            onProbableEnd: () => activeSocket.speculate(),
            onTurnClose: () => {
              setStatus('translating');
              setMuted(true);
              activeSocket.endSession();
            },
            onLevel: (value) => {
              const now = Date.now();
              if (now - lastLevelAtRef.current < LEVEL_UPDATE_MS) return;
              lastLevelAtRef.current = now;
              setLevel(value);
            },
            onEchoHeard: () => setEchoHeard((count) => count + 1),
          },
          Math.max(
            1,
            Math.floor(WORKLET_BLOCK_SAMPLES / (activeContext.sampleRate / TARGET_SAMPLE_RATE)),
          ),
          FULL_DUPLEX_ALLOWED && options.fullDuplex === true,
        );

        const node = new AudioWorkletNode(context, 'mic-capture-processor');
        node.port.onmessage = (message: MessageEvent<Float32Array>) => {
          pump.push(downsampleToPcm16(message.data, activeContext.sampleRate));
        };
        context.createMediaStreamSource(stream).connect(node);

        socketRef.current = socket;
        contextRef.current = context;
        streamRef.current = stream;
        playbackRef.current = playback;
        pumpRef.current = pump;
        nodeRef.current = node;
        setStatus('listening');
      } catch (err) {
        abandon();
        stop();
        setError(err instanceof Error ? err.message : 'Could not start the conversation');
      }
    },
    [armNextTurnIfDone, handleServerEvent, options.fullDuplex, sendBlock, stop],
  );

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
