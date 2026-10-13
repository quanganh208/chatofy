'use client';

/**
 * Reusable hook for a mediasoup conference room.
 *
 * Extracted verbatim from `conference-poc/page.tsx` (Issue #207) so that
 * Phases 2–3 can build UI and fix translation against a stable typed surface.
 *
 * Phase 3 changes (bidirectional translation + ordered audio + subtitle coalescing):
 *  - `wireTranslate`: direction now computed as `${source}_to_${target}` where
 *    target is the other language in the vi↔en pair (fixes the hardcoded `_to_en`).
 *  - Audio playback replaced by `TranslationAudioSink` (one AudioContext per
 *    speaker, in-order delivery, no per-frame context leak). Closed in `leave()`.
 *  - Subtitle handler keys by `(speakerSocketId, turnId)`: replaces while
 *    isFinal===false, locks on final, clears after 4 s.
 *
 * Phase 3 (folded-in hook control state):
 *  - `toggleMute` / `toggleVideo` now send the actual boolean and apply it to
 *    the local MediaStreamTrack (`enabled` flag).
 *  - Local `muted` / `videoEnabled` state is tracked and exposed as
 *    `localMuted` / `localVideoEnabled` in the return value.
 *
 * Latency markers kept from the PoC:
 *  [T1] first audio frame sent to /ws/translate
 *  [T2] server.live.transcript target received
 *  [T3] conference.translation.subtitle received by listener
 *  [T4] conference.translation.audio received and queued (logged inside TranslationAudioSink)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSession } from 'next-auth/react';
import * as mediasoupClient from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { WS_SUBPROTOCOL } from '@chatofy/types/events';
import { TranslationAudioSink } from './use-translation-audio-sink';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_WS_URL = process.env['NEXT_PUBLIC_API_WS_URL'] ?? 'ws://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConferenceStatus = 'idle' | 'connecting' | 'in-call' | 'error' | 'disconnected';

/**
 * Machine-readable reason attached to `status === 'error'` or `status === 'disconnected'`.
 *
 * - `'permission-denied'` — getUserMedia rejected with NotAllowedError / NotFoundError.
 *   The page should prompt the user to grant camera/mic access and reload.
 * - `'audio-only'` — video permission denied but audio succeeded.
 *   The call continues with audio only; the page can surface a soft notice.
 * - `'not-authenticated'` — no access token in the session; the hook sets this
 *   before the page redirects to /login (the app layout also gates the route, but
 *   the hook fires earlier in the client render cycle).
 * - `'connection-lost'` — the WS closed unexpectedly mid-call (heartbeat eviction
 *   or network drop). The page should show "call ended" and return to the lobby.
 * - `'generic'` — any other runtime error during join.
 */
export type ConferenceErrorReason =
  'permission-denied' | 'audio-only' | 'not-authenticated' | 'connection-lost' | 'generic';

export interface PeerState {
  displayName: string;
  stream: MediaStream;
  /** Latest subtitle text for this peer; undefined when none active. */
  subtitle: string | undefined;
  muted: boolean;
  videoEnabled: boolean;
}

export interface UseConferenceReturn {
  status: ConferenceStatus;
  /**
   * Present when `status === 'error'` or `status === 'disconnected'`.
   * Undefined in all other states.
   */
  errorReason: ConferenceErrorReason | undefined;
  localStream: MediaStream | null;
  /** socketId → PeerState for all remote peers */
  peers: Map<string, PeerState>;
  mySocketId: string | null;
  /** Whether the local microphone track is currently muted. */
  localMuted: boolean;
  /** Whether the local video track is currently enabled. */
  localVideoEnabled: boolean;
  /**
   * True when one or more TTS AudioContexts are still suspended (browser
   * autoplay policy). The in-call page shows a "tap to enable sound" affordance
   * while this is true. Clears after `resumeAudio()` succeeds.
   */
  audioBlocked: boolean;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  /** Resume all suspended TTS AudioContexts. Must be called from a user gesture. */
  resumeAudio: () => Promise<void>;
}

// ─── Signaling helpers (module-level, not hooks) ──────────────────────────────

type SignalMessage = { event: string; data: unknown };

function send(ws: WebSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

function request(ws: WebSocket, event: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as SignalMessage;
        if (parsed.event === event) {
          ws.removeEventListener('message', handler);
          resolve(parsed.data);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    ws.addEventListener('message', handler);
    send(ws, event, data);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 10_000);
  });
}

function waitForEvent(ws: WebSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as SignalMessage;
        if (parsed.event === event) {
          ws.removeEventListener('message', handler);
          resolve(parsed.data);
        }
      } catch {
        /* ignore */
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout: ${event}`));
    }, 10_000);
  });
}

function wireSendTransport(
  ws: WebSocket,
  transport: types.Transport,
  log: (m: string) => void,
): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    log('send transport connect');
    request(ws, 'conference.transport.connect', {
      transportId: transport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });

  transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    log(`produce ${kind}`);
    request(ws, 'conference.produce', { kind, rtpParameters, appData })
      .then((resp) => callback({ id: (resp as { id: string }).id }))
      .catch(errback);
  });
}

function wireRecvTransport(
  ws: WebSocket,
  transport: types.Transport,
  log: (m: string) => void,
): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    log('recv transport connect');
    request(ws, 'conference.transport.connect', {
      transportId: transport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });
}

async function consumeTrack(
  ws: WebSocket,
  device: types.Device,
  recvTransport: types.Transport,
  producerId: string,
  producerSocketId: string,
  log: (m: string) => void,
  onTrack: (socketId: string, track: MediaStreamTrack) => void,
): Promise<void> {
  send(ws, 'conference.consume', {
    producerId,
    rtpCapabilities: device.rtpCapabilities,
  });

  const consumerParams = (await waitForEvent(ws, 'conference.consume')) as types.ConsumerOptions & {
    id: string;
  };
  if ('error' in consumerParams) {
    log(`Cannot consume: ${(consumerParams as unknown as { error: string }).error}`);
    return;
  }

  const consumer = await recvTransport.consume(consumerParams);
  log(`Consuming ${consumer.kind} track from ${producerSocketId}`);

  onTrack(producerSocketId, consumer.track);

  send(ws, 'conference.consumer.resume', { consumerId: consumer.id });
  await waitForEvent(ws, 'conference.consumer.resume');
  log(`Consumer ${consumer.id} resumed`);
}

/**
 * Open a /ws/translate socket in live mode for this speaker.
 * Forwards transcript/audio events into /ws/conference for all room participants.
 *
 * Phase 3: direction is now bidirectional — computed as `${source}_to_${target}`
 * where target is the other language in the vi↔en pair.
 *
 * [T1] first audio frame sent
 * [T2] server.live.transcript target received
 */
function wireTranslate(
  confWs: WebSocket,
  stream: MediaStream,
  socketId: string,
  speakerDisplayName: string,
  sourceLanguage: string,
  token: string,
  log: (m: string) => void,
): void {
  // Phase 3: compute the OTHER language in the vi↔en pair.
  const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
  const direction = `${sourceLanguage}_to_${targetLanguage}`;

  const translateWs = new WebSocket(`${API_WS_URL}/ws/translate`, [WS_SUBPROTOCOL, token]);
  const turnId = crypto.randomUUID();
  let t1 = 0;

  translateWs.addEventListener('open', () => {
    log('[translate] WS open');
    translateWs.send(
      JSON.stringify({
        event: 'client.live.start',
        data: { type: 'client.live.start', direction },
      }),
    );
  });

  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const src = audioCtx.createMediaStreamSource(stream);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  let seq = 0;
  processor.onaudioprocess = (evt) => {
    if (translateWs.readyState !== WebSocket.OPEN) return;
    if (seq === 0) {
      t1 = performance.now();
      console.log(`[T1] first audio frame t=${t1.toFixed(1)}ms`);
    }
    const float32 = evt.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, (float32[i] ?? 0) * 32768));
    }
    const b64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
    translateWs.send(
      JSON.stringify({
        event: 'client.live.audio',
        data: {
          type: 'client.live.audio',
          frame: {
            sessionId: turnId,
            encoding: 'pcm16',
            sampleRate: 16000,
            sequence: seq++,
            timestamp: Date.now(),
            payload: b64,
          },
        },
      }),
    );
  };
  const silence = audioCtx.createGain();
  silence.gain.value = 0;
  src.connect(processor);
  processor.connect(silence);
  silence.connect(audioCtx.destination);

  translateWs.addEventListener('message', (evt: MessageEvent<string>) => {
    const msg = JSON.parse(evt.data) as { type: string; [k: string]: unknown };

    if (msg.type === 'server.live.transcript') {
      const d = msg as { type: string; channel: 'source' | 'target'; delta: string; lang: string };
      if (d.channel === 'target') {
        console.log(
          `[T2] transcript target t=${performance.now().toFixed(1)}ms Δ=${(performance.now() - t1).toFixed(0)}ms`,
        );
        log(`[T2] transcript: "${d.delta}"`);
      }
      send(confWs, 'conference.translation.broadcast', {
        subtitle: {
          speakerSocketId: socketId,
          speakerDisplayName,
          sourceLanguage,
          targetLang: targetLanguage,
          sourceText: d.delta,
          translatedText: d.delta,
          isFinal: d.channel === 'target',
          turnId,
        },
      });
    }

    if (msg.type === 'server.live.audio') {
      const d = msg as {
        type: string;
        frame: { sequence: number; sampleRate: number; payload: string };
      };
      send(confWs, 'conference.translation.broadcast', {
        audio: {
          speakerSocketId: socketId,
          lang: targetLanguage,
          sequence: d.frame.sequence,
          sampleRate: d.frame.sampleRate,
          payload: d.frame.payload,
        },
      });
    }
  });

  translateWs.addEventListener('close', () => {
    processor.disconnect();
    void audioCtx.close();
    log('[translate] WS closed');
  });
  translateWs.addEventListener('error', () => log('[translate] WS error'));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useConference(
  roomId: string,
  options: { displayName: string; sourceLanguage: string },
): UseConferenceReturn {
  const { displayName, sourceLanguage } = options;

  const [status, setStatus] = useState<ConferenceStatus>('idle');
  const [errorReason, setErrorReason] = useState<ConferenceErrorReason | undefined>(undefined);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  // Phase 3 (folded-in): local mute/video state exposed to the UI.
  const [localMuted, setLocalMuted] = useState(false);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  // Phase 1 (audio unlock): true when any TTS AudioContext is still suspended.
  const [audioBlocked, setAudioBlocked] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<types.Device | null>(null);
  /** socketId → displayName for label lookup before PeerState is created */
  const peersRef = useRef<Map<string, string>>(new Map());
  const mySocketIdRef = useRef<string | null>(null);
  /** Phase 3: one ordered audio sink for the whole call, closed on leave(). */
  const audioSinkRef = useRef<TranslationAudioSink | null>(null);
  /** Phase 3: ref-copy of localStream for use inside callbacks without stale closure. */
  const localStreamRef = useRef<MediaStream | null>(null);
  /** Phase 3: ref-copies of mute/video state for use inside callbacks. */
  const localMutedRef = useRef(false);
  const localVideoEnabledRef = useRef(true);

  const addLog = useCallback((msg: string) => {
    console.debug(`[conference] ${new Date().toISOString().slice(11, 23)} ${msg}`);
  }, []);

  /** Upsert a track into the peers map. */
  const onTrack = useCallback((socketId: string, track: MediaStreamTrack) => {
    setPeers((prev) => {
      const next = new Map(prev);
      const entry = next.get(socketId);
      if (entry) {
        entry.stream.addTrack(track);
        next.set(socketId, { ...entry });
      } else {
        const stream = new MediaStream([track]);
        next.set(socketId, {
          stream,
          displayName: peersRef.current.get(socketId) ?? socketId,
          subtitle: undefined,
          muted: false,
          videoEnabled: true,
        });
      }
      return next;
    });
  }, []);

  const join = useCallback(async () => {
    if (!displayName.trim()) {
      addLog('displayName is empty');
      return;
    }
    setStatus('connecting');

    const session = await getSession();
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (!token) {
      addLog('Not logged in — redirecting to /login.');
      setErrorReason('not-authenticated');
      setStatus('error');
      // Redirect client-side; the server layout already gates the route but the
      // hook fires earlier in the render cycle (client-side join auto-invocation).
      if (typeof window !== 'undefined') {
        const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login?callbackUrl=${callbackUrl}`);
      }
      return;
    }

    // Phase 3: create the ordered audio sink for this call.
    audioSinkRef.current = new TranslationAudioSink();

    const ws = new WebSocket(`${API_WS_URL}/ws/conference`, [WS_SUBPROTOCOL, token]);
    wsRef.current = ws;

    ws.addEventListener('open', async () => {
      try {
        addLog('WS connected');

        send(ws, 'conference.join', { roomId, displayName, sourceLanguage });
        const joinResp = await waitForEvent(ws, 'conference.join');
        const {
          rtpCapabilities,
          peers: existingPeers,
          socketId,
        } = joinResp as {
          rtpCapabilities: types.RtpCapabilities;
          peers: {
            socketId: string;
            displayName: string;
            producers: { producerId: string; kind: string }[];
          }[];
          socketId: string;
        };
        addLog(
          `Joined as ${socketId}. Peers: ${existingPeers.map((p) => p.displayName).join(', ') || 'none'}`,
        );
        mySocketIdRef.current = socketId;
        setMySocketId(socketId);

        for (const peer of existingPeers) {
          peersRef.current.set(peer.socketId, peer.displayName);
        }

        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;
        addLog('Device loaded');

        // Phase 5: handle permission denial gracefully.
        // Try audio+video; on failure attempt audio-only; on total failure surface
        // a clear 'permission-denied' state rather than an uncaught throw.
        let stream: MediaStream;
        let audioOnly = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch (mediaErr) {
          const name = (mediaErr as Error).name;
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            // Camera denied — try audio-only so the call can still proceed.
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              audioOnly = true;
              addLog('Camera permission denied — joining audio-only.');
            } catch {
              addLog('Mic permission denied — cannot join.');
              setErrorReason('permission-denied');
              setStatus('error');
              ws.close();
              return;
            }
          } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            // No camera device — fall back to audio-only automatically.
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              audioOnly = true;
              addLog('No camera found — joining audio-only.');
            } catch {
              addLog('No audio device — cannot join.');
              setErrorReason('permission-denied');
              setStatus('error');
              ws.close();
              return;
            }
          } else {
            throw mediaErr;
          }
        }
        if (audioOnly) {
          // Surface a soft notice to the room page without blocking the call.
          setErrorReason('audio-only');
        }
        setLocalStream(stream);
        localStreamRef.current = stream;
        addLog('Got local media');

        send(ws, 'conference.transport.create', { direction: 'send' });
        const sendParams = (await waitForEvent(
          ws,
          'conference.transport.create',
        )) as types.TransportOptions & { iceServers?: RTCIceServer[] };
        addLog(`TURN servers: ${sendParams.iceServers?.length ?? 0}`);
        const sendTransport = device.createSendTransport(sendParams);
        wireSendTransport(ws, sendTransport, addLog);

        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track });
          addLog(`Producing ${track.kind}`);
        }

        send(ws, 'conference.transport.create', { direction: 'recv' });
        const recvParams = (await waitForEvent(
          ws,
          'conference.transport.create',
        )) as types.TransportOptions & { iceServers?: RTCIceServer[] };
        const recvTransport = device.createRecvTransport(recvParams);
        wireRecvTransport(ws, recvTransport, addLog);

        // Open /ws/translate in live mode for this speaker's audio translation.
        wireTranslate(ws, stream, socketId, displayName, sourceLanguage, token, addLog);

        // Consume existing peers' producers (late-joiner catch-up).
        for (const peer of existingPeers) {
          for (const producer of peer.producers) {
            addLog(`Consuming existing ${producer.kind} from ${peer.displayName}`);
            await consumeTrack(
              ws,
              device,
              recvTransport,
              producer.producerId,
              peer.socketId,
              addLog,
              onTrack,
            );
          }
        }

        setStatus('in-call');

        // Phase 1: attempt an optimistic resume now that a join gesture occurred.
        // If the browser still suspends the contexts (no frames yet so no contexts
        // exist here), audioBlocked will be set to true when the first frame arrives.
        if (audioSinkRef.current) {
          void audioSinkRef.current.resumeAll();
          setAudioBlocked(audioSinkRef.current.isAnySuspended());
        }

        // Handle new producers from peers joining later.
        ws.addEventListener('message', async (evt: MessageEvent<string>) => {
          const msg = JSON.parse(evt.data) as SignalMessage;

          if (msg.event === 'conference.new.producer') {
            const {
              producerId,
              socketId: peerSocketId,
              kind,
            } = msg.data as { producerId: string; socketId: string; kind: string };
            addLog(`New ${kind} producer ${producerId} from ${peerSocketId}`);
            await consumeTrack(
              ws,
              device,
              recvTransport,
              producerId,
              peerSocketId,
              addLog,
              onTrack,
            );
          }

          if (msg.event === 'conference.peer.joined') {
            const { socketId: peerSid, displayName: peerName } = msg.data as {
              socketId: string;
              displayName: string;
            };
            peersRef.current.set(peerSid, peerName);
            addLog(`Peer joined: ${peerName}`);
          }

          if (msg.event === 'conference.peer.left') {
            const { socketId: peerSid } = msg.data as { socketId: string };
            peersRef.current.delete(peerSid);
            setPeers((prev) => {
              const next = new Map(prev);
              next.delete(peerSid);
              return next;
            });
            addLog(`Peer left: ${peerSid}`);
          }

          if (msg.event === 'conference.participant.state') {
            const d = msg.data as {
              socketId: string;
              muted?: boolean;
              videoEnabled?: boolean;
            };
            setPeers((prev) => {
              const entry = prev.get(d.socketId);
              if (!entry) return prev;
              const next = new Map(prev);
              next.set(d.socketId, {
                ...entry,
                muted: d.muted ?? entry.muted,
                videoEnabled: d.videoEnabled ?? entry.videoEnabled,
              });
              return next;
            });
          }

          if (msg.event === 'conference.translation.subtitle') {
            const d = msg.data as {
              speakerSocketId: string;
              speakerDisplayName: string;
              translatedText?: string;
              sourceText?: string;
              isFinal: boolean;
              turnId?: string;
            };
            // [T3] subtitle received by listener
            console.log(
              `[T3] subtitle received t=${performance.now().toFixed(1)}ms final=${d.isFinal}`,
            );
            addLog(
              `[sub] ${d.speakerDisplayName}: ${d.translatedText ?? d.sourceText ?? ''}${d.isFinal ? '' : '…'}`,
            );
            const text = d.translatedText ?? d.sourceText ?? '';
            // Phase 3: key subtitle by (speakerSocketId, turnId) so partial frames
            // replace in-place and a new turn after final doesn't flicker.
            const subtitleKey = d.turnId ? `${d.speakerSocketId}:${d.turnId}` : d.speakerSocketId;

            setPeers((prev) => {
              const next = new Map(prev);
              const entry = next.get(d.speakerSocketId);
              if (entry) {
                // Store both the visible text and which key last wrote it.
                next.set(d.speakerSocketId, {
                  ...entry,
                  subtitle: text,
                  // Carry the key so the clear timer below only clears its own turn.
                  _subtitleKey: subtitleKey,
                } as PeerState & { _subtitleKey: string });
              }
              return next;
            });

            if (d.isFinal) {
              // Clear only when this specific turn's subtitle is still showing.
              setTimeout(() => {
                setPeers((prev) => {
                  const entry = prev.get(d.speakerSocketId) as
                    (PeerState & { _subtitleKey?: string }) | undefined;
                  if (!entry) return prev;
                  // Only clear if our key is still the active one (a newer turn
                  // hasn't replaced it while the timer was pending).
                  if (entry._subtitleKey !== subtitleKey) return prev;
                  const next = new Map(prev);
                  next.set(d.speakerSocketId, { ...entry, subtitle: undefined });
                  return next;
                });
              }, 4000);
            }
          }

          if (msg.event === 'conference.translation.audio') {
            const d = msg.data as {
              speakerSocketId: string;
              sampleRate: number;
              sequence: number;
              payload: string;
            };
            // [T4] delegated to TranslationAudioSink (logged there).
            audioSinkRef.current?.push(d.speakerSocketId, d.sequence, d.sampleRate, d.payload);
            // Phase 1: a new AudioContext was lazily created for this speaker;
            // check whether it ended up suspended (autoplay policy).
            if (audioSinkRef.current) {
              setAudioBlocked(audioSinkRef.current.isAnySuspended());
            }
          }
        });
      } catch (err) {
        addLog(`Error: ${(err as Error).message}`);
        setErrorReason('generic');
        setStatus('error');
      }
    });

    ws.addEventListener('close', () => {
      addLog('WS closed');
      // If we were in-call (not an intentional leave() which sets status to
      // 'idle' before closing the socket), surface 'disconnected' so the page
      // can show "connection lost / call ended" and return to lobby cleanly.
      setStatus((prev) => {
        if (prev === 'in-call' || prev === 'connecting') {
          setErrorReason('connection-lost');
          return 'disconnected';
        }
        // Intentional leave: leave() already set status to 'idle'.
        return 'idle';
      });
      setPeers(new Map());
    });

    ws.addEventListener('error', (e) => {
      addLog(`WS error: ${JSON.stringify(e)}`);
    });
  }, [roomId, displayName, sourceLanguage, addLog, onTrack]);

  const leave = useCallback(() => {
    // Set status to 'idle' BEFORE closing the socket so the WS 'close' handler
    // sees 'idle' and does not override it with 'disconnected'.
    setStatus('idle');
    setErrorReason(undefined);
    wsRef.current?.close();
    wsRef.current = null;
    deviceRef.current = null;
    peersRef.current.clear();
    mySocketIdRef.current = null;
    // Phase 3: close the ordered audio sink (releases all AudioContexts).
    audioSinkRef.current?.close();
    audioSinkRef.current = null;
    setLocalStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((t) => t.stop());
      }
      localStreamRef.current = null;
      return null;
    });
    // Reset local state.
    localMutedRef.current = false;
    localVideoEnabledRef.current = true;
    setLocalMuted(false);
    setLocalVideoEnabled(true);
    setAudioBlocked(false);
    setPeers(new Map());
    setMySocketId(null);
    setStatus('idle');
    addLog('Left room');
  }, [addLog]);

  /**
   * Toggle local microphone mute.
   *
   * Phase 3 (folded-in): sends the real `{ muted: boolean }` payload the gateway
   * expects (was sending `{}`) and applies the change to the local audio track.
   */
  const toggleMute = useCallback(() => {
    const nextMuted = !localMutedRef.current;
    localMutedRef.current = nextMuted;
    setLocalMuted(nextMuted);

    // Apply to the local MediaStream audio tracks.
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.mute', { muted: nextMuted });
    }
  }, []);

  /**
   * Toggle local camera.
   *
   * Phase 3 (folded-in): sends the real `{ videoEnabled: boolean }` payload the
   * gateway expects (was sending `{}`) and applies the change to the local video track.
   */
  const toggleVideo = useCallback(() => {
    const nextVideoEnabled = !localVideoEnabledRef.current;
    localVideoEnabledRef.current = nextVideoEnabled;
    setLocalVideoEnabled(nextVideoEnabled);

    // Apply to the local MediaStream video tracks.
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = nextVideoEnabled;
      });
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.video', { videoEnabled: nextVideoEnabled });
    }
  }, []);

  /**
   * Resume all suspended TTS AudioContexts.
   *
   * Must be called from a direct user-gesture handler (e.g. a button click) so
   * the browser permits the resume. Clears `audioBlocked` on success.
   */
  const resumeAudio = useCallback(async () => {
    if (audioSinkRef.current) {
      await audioSinkRef.current.resumeAll();
      setAudioBlocked(audioSinkRef.current.isAnySuspended());
    }
  }, []);

  // Close on unmount.
  useEffect(
    () => () => {
      wsRef.current?.close();
      audioSinkRef.current?.close();
    },
    [],
  );

  return {
    status,
    errorReason,
    localStream,
    peers,
    mySocketId,
    localMuted,
    localVideoEnabled,
    audioBlocked,
    join,
    leave,
    toggleMute,
    toggleVideo,
    resumeAudio,
  };
}
