/**
 * React Native conference hook — the mobile parallel of web's `useConference`.
 *
 * Mirrors the web `UseConferenceReturn` contract (apps/web/src/hooks/use-conference.ts
 * lines 48–143) so the mobile call screen reads the same surface as web. This file
 * implements the VIDEO subset: status/error state machine, local media, remote peer
 * map, mic/cam/leave, bounded reconnect, RN permissions, and teardown. The
 * translation and chat fields (`audioBlocked`, `localTranslating`, `resumeAudio`,
 * `messages`, `sendChat`) are present but inert until Phases 2–4.
 *
 * Media plumbing (registerGlobals, raw WS signaling, mediasoup Device + send/recv
 * transports, getUserMedia, consume-on-new-producer) is lifted from the proven PoC
 * (conference-poc.tsx). The reconnect loop and peer-state reducer are ported from
 * the web hook. The mediasoup ↔ react-native-webrtc track-type mismatch is contained
 * entirely in native-media-adapter.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { registerGlobals, mediaDevices, MediaStream } from 'react-native-webrtc';
import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { WS_SUBPROTOCOL } from '@chatofy/types/events';
import type { ConferenceChatMessage } from '@chatofy/types/events';
import { toMediasoupTrack, toNativeTrack } from './native-media-adapter';
import { NativeTranslationAudioSink } from './native-audio-playback';
import { NativeAudioCapture } from './native-audio-capture';
import { startTranslateBridge, type TranslateBridge } from './translate-bridge-native';

// MUST be called once at module load, before any Device is constructed. This installs
// react-native-webrtc's RTCPeerConnection/MediaStream/MediaStreamTrack as the globals
// mediasoup-client reaches for.
registerGlobals();

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://10.0.2.2:3000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const WS_URL = WS_BASE + '/ws/conference';
/** Second socket for live translation, opened by the translate bridge on join. */
const TRANSLATE_WS_URL = WS_BASE + '/ws/translate';

/** Maximum number of automatic reconnect attempts before giving up. */
const RECONNECT_CAP = 3;
/** Max chat messages retained per meeting (ephemeral, bounded). Same as web. */
const CHAT_MESSAGE_CAP = 200;
/** Backoff delays (ms) indexed by attempt number (0-based). */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

// ─── Types (mirror web's UseConferenceReturn) ──────────────────────────────────

export type ConferenceStatus =
  'idle' | 'connecting' | 'in-call' | 'error' | 'disconnected' | 'reconnecting';

/**
 * Machine-readable reason attached to `status === 'error'` or `'disconnected'`.
 * Same vocabulary as web so the call screen can branch identically.
 */
export type ConferenceErrorReason =
  'permission-denied' | 'audio-only' | 'not-authenticated' | 'connection-lost' | 'generic';

export interface PeerState {
  displayName: string;
  /** react-native-webrtc MediaStream, consumed by RTCView via `.toURL()`. */
  stream: MediaStream;
  /** Latest subtitle text for this peer; undefined when none active. (Phase 3.) */
  subtitle: string | undefined;
  muted: boolean;
  videoEnabled: boolean;
}

export interface UseConferenceReturn {
  status: ConferenceStatus;
  /** Present when `status === 'error'` or `'disconnected'`; undefined otherwise. */
  errorReason: ConferenceErrorReason | undefined;
  localStream: MediaStream | null;
  /** socketId → PeerState for all remote peers. */
  peers: Map<string, PeerState>;
  mySocketId: string | null;
  localMuted: boolean;
  localVideoEnabled: boolean;
  /** Always false on RN — there is no autoplay gate to block TTS playback. */
  audioBlocked: boolean;
  /** True from a turn's first captured mic frame until its final subtitle (or a timeout). */
  localTranslating: boolean;
  /** Current reconnect attempt (1-based). 0 when not reconnecting. */
  reconnectAttempt: number;
  /** Maximum reconnect attempts before giving up to `disconnected`. */
  reconnectCap: number;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  /** No-op on RN (no autoplay gate); kept for contract parity with web. */
  resumeAudio: () => Promise<void>;
  /**
   * In-meeting chat messages in arrival order, each already in this client's
   * chosen language. Bounded to the last {@link CHAT_MESSAGE_CAP} for the meeting.
   */
  messages: ConferenceChatMessage[];
  /** Send a chat message. No-op for blank/whitespace-only text or a closed socket. */
  sendChat: (text: string) => void;
}

// ─── Signaling helpers (module-level, not hooks) ───────────────────────────────

type SignalMessage = { event: string; data: unknown };

function send(ws: WebSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

/** Send `event` and resolve with the data of the first reply carrying the same name. */
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

function wireSendTransport(ws: WebSocket, transport: types.Transport): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    request(ws, 'conference.transport.connect', { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });

  transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    request(ws, 'conference.produce', { kind, rtpParameters, appData })
      .then((resp) => callback({ id: (resp as { id: string }).id }))
      .catch(errback);
  });
}

function wireRecvTransport(ws: WebSocket, transport: types.Transport): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    request(ws, 'conference.transport.connect', { transportId: transport.id, dtlsParameters })
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
  onTrack: (socketId: string, stream: MediaStream) => void,
): Promise<void> {
  const params = (await request(ws, 'conference.consume', {
    producerId,
    rtpCapabilities: device.rtpCapabilities,
  })) as types.ConsumerOptions & { error?: string };
  if ('error' in params && params.error) return;

  const consumer = await recvTransport.consume(params);
  await request(ws, 'conference.consumer.resume', { consumerId: consumer.id });

  // consumer.track is DOM-typed by mediasoup-client; adapt it to the native track
  // before adding it to the native MediaStream RTCView renders.
  const stream = new MediaStream();
  stream.addTrack(toNativeTrack(consumer.track));
  onTrack(producerSocketId, stream);
}

// Android runtime permission request. iOS resolves camera/mic through Info.plist usage
// strings and the implicit prompt getUserMedia triggers, so nothing is needed here.
async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useConferenceNative(
  roomId: string,
  options: { displayName: string; sourceLanguage: string; getToken: () => Promise<string> },
): UseConferenceReturn {
  const { displayName, sourceLanguage, getToken } = options;

  const [status, setStatus] = useState<ConferenceStatus>('idle');
  const [errorReason, setErrorReason] = useState<ConferenceErrorReason | undefined>(undefined);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const [localTranslating, setLocalTranslating] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  // In-meeting chat: bounded message list, each already in this client's language.
  const [messages, setMessages] = useState<ConferenceChatMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  /** Ordered per-speaker TTS playback sink; created on join, closed on leave. */
  const audioSinkRef = useRef<NativeTranslationAudioSink | null>(null);
  /** Live translate bridge (mic → /ws/translate → broadcast); stopped on leave. */
  const translateBridgeRef = useRef<TranslateBridge | null>(null);
  /** The token for this call, captured so the translate bridge can open its socket. */
  const tokenRef = useRef<string | null>(null);
  const deviceRef = useRef<types.Device | null>(null);
  /** socketId → displayName, known before a PeerState exists (from join/peer.joined). */
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  const mySocketIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localMutedRef = useRef(false);
  const localVideoEnabledRef = useRef(true);
  /** Set by leave() so the ws close handler knows an intentional leave from a drop. */
  const intentionalLeaveRef = useRef(false);
  const reconnectAttemptRef = useRef(0);

  /** Upsert a remote track's stream into the peers map. */
  const onTrack = useCallback((socketId: string, stream: MediaStream) => {
    setPeers((prev) => {
      const next = new Map(prev);
      const entry = next.get(socketId);
      if (entry) {
        // A peer already has a tile (e.g. audio arrived first); merge in the new
        // track. A NEW MediaStream is built from the combined tracks so its
        // `toURL()` changes — adding a track to the existing stream in place keeps
        // the same URL, so RTCView never re-attaches and video stays black.
        const merged = new MediaStream();
        entry.stream.getTracks().forEach((t) => merged.addTrack(t));
        stream.getTracks().forEach((t) => merged.addTrack(t));
        next.set(socketId, { ...entry, stream: merged });
      } else {
        next.set(socketId, {
          stream,
          displayName: peerNamesRef.current.get(socketId) ?? socketId,
          subtitle: undefined,
          muted: false,
          videoEnabled: true,
        });
      }
      return next;
    });
  }, []);

  /**
   * Release all media/transport resources held by a prior attempt so a reconnect
   * starts clean. Does NOT touch wsRef (caller owns it) or status (caller sets it).
   */
  const teardownMediaResources = useCallback(() => {
    deviceRef.current = null;
    peerNamesRef.current.clear();
    mySocketIdRef.current = null;
    const prev = localStreamRef.current;
    if (prev) prev.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    // Release the translate bridge (recorder + socket) and the playback sink so
    // a reconnect starts clean and no mic/AudioContext is left held.
    void translateBridgeRef.current?.stop();
    translateBridgeRef.current = null;
    audioSinkRef.current?.close();
    audioSinkRef.current = null;
    setLocalTranslating(false);
    setLocalStream(null);
    setPeers(new Map());
    setMySocketId(null);
  }, []);

  /**
   * Run the full join sequence on an already-open WebSocket. Re-run verbatim on each
   * reconnect attempt. On success → `in-call` + reset reconnect counter; on failure →
   * `error` with the appropriate reason.
   */
  const runJoinSequence = useCallback(
    async (ws: WebSocket) => {
      let onMessage: ((evt: MessageEvent<string>) => void) | undefined;
      try {
        const joinResp = (await request(ws, 'conference.join', {
          roomId,
          displayName,
          sourceLanguage,
        })) as {
          socketId: string;
          rtpCapabilities: types.RtpCapabilities;
          peers: { socketId: string; displayName: string; producers: { producerId: string }[] }[];
          error?: string;
        };
        if (joinResp.error) {
          setErrorReason(joinResp.error === 'not_authenticated' ? 'not-authenticated' : 'generic');
          setStatus('error');
          ws.close();
          return;
        }

        mySocketIdRef.current = joinResp.socketId;
        setMySocketId(joinResp.socketId);
        for (const peer of joinResp.peers) {
          peerNamesRef.current.set(peer.socketId, peer.displayName);
        }

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinResp.rtpCapabilities });
        deviceRef.current = device;

        // Try audio+video; on camera denial fall back to audio-only; on total denial
        // surface 'permission-denied' rather than throwing — matches web's degradation.
        let stream: MediaStream;
        let audioOnly = false;
        try {
          stream = (await mediaDevices.getUserMedia({ audio: true, video: true })) as MediaStream;
        } catch (mediaErr) {
          const name = (mediaErr as Error).name;
          if (
            name === 'NotAllowedError' ||
            name === 'PermissionDeniedError' ||
            name === 'NotFoundError'
          ) {
            try {
              stream = (await mediaDevices.getUserMedia({
                audio: true,
                video: false,
              })) as MediaStream;
              audioOnly = true;
            } catch {
              setErrorReason('permission-denied');
              setStatus('error');
              ws.close();
              return;
            }
          } else {
            throw mediaErr;
          }
        }
        if (audioOnly) setErrorReason('audio-only');
        setLocalStream(stream);
        localStreamRef.current = stream;
        // Re-apply any mute/video state carried across a reconnect.
        stream.getAudioTracks().forEach((t) => (t.enabled = !localMutedRef.current));
        stream.getVideoTracks().forEach((t) => (t.enabled = localVideoEnabledRef.current));

        const sendParams = (await request(ws, 'conference.transport.create', {
          direction: 'send',
        })) as types.TransportOptions;
        const sendTransport = device.createSendTransport(sendParams);
        wireSendTransport(ws, sendTransport);

        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track: toMediasoupTrack(track) });
        }

        const recvParams = (await request(ws, 'conference.transport.create', {
          direction: 'recv',
        })) as types.TransportOptions;
        const recvTransport = device.createRecvTransport(recvParams);
        wireRecvTransport(ws, recvTransport);

        // Catch up on peers already producing when we joined.
        for (const peer of joinResp.peers) {
          for (const producer of peer.producers) {
            await consumeTrack(
              ws,
              device,
              recvTransport,
              producer.producerId,
              peer.socketId,
              onTrack,
            );
          }
        }

        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setStatus('in-call');

        // Inbound room events for the life of the call. Named so it can be
        // removed when the join sequence ends (reconnect or error path).
        onMessage = (evt: MessageEvent<string>): void => {
          let msg: SignalMessage;
          try {
            msg = JSON.parse(evt.data) as SignalMessage;
          } catch {
            return;
          }

          if (msg.event === 'conference.new.producer') {
            const d = msg.data as { producerId: string; socketId: string };
            if (d.socketId !== mySocketIdRef.current) {
              void consumeTrack(ws, device, recvTransport, d.producerId, d.socketId, onTrack);
            }
            return;
          }

          if (msg.event === 'conference.peer.joined') {
            const d = msg.data as { socketId: string; displayName: string };
            peerNamesRef.current.set(d.socketId, d.displayName);
            return;
          }

          if (msg.event === 'conference.peer.left') {
            const d = msg.data as { socketId: string };
            peerNamesRef.current.delete(d.socketId);
            setPeers((prev) => {
              if (!prev.has(d.socketId)) return prev;
              const next = new Map(prev);
              const gone = next.get(d.socketId);
              gone?.stream.getTracks().forEach((t) => t.stop());
              next.delete(d.socketId);
              return next;
            });
            return;
          }

          if (msg.event === 'conference.participant.state') {
            const d = msg.data as { socketId: string; muted?: boolean; videoEnabled?: boolean };
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
            return;
          }

          // Incoming subtitle from a translating peer. Keyed by (speakerSocketId,
          // turnId) so partial frames replace in-place and a final-frame clear
          // timer only clears its own turn. Mirrors web's listener handling.
          if (msg.event === 'conference.translation.subtitle') {
            const d = msg.data as {
              speakerSocketId: string;
              translatedText?: string;
              sourceText?: string;
              isFinal: boolean;
              turnId?: string;
            };
            const text = d.translatedText ?? d.sourceText ?? '';
            const subtitleKey = d.turnId ? `${d.speakerSocketId}:${d.turnId}` : d.speakerSocketId;

            setPeers((prev) => {
              const entry = prev.get(d.speakerSocketId);
              if (!entry) return prev;
              const next = new Map(prev);
              next.set(d.speakerSocketId, {
                ...entry,
                subtitle: text,
                _subtitleKey: subtitleKey,
              } as PeerState & { _subtitleKey: string });
              return next;
            });

            if (d.isFinal) {
              // Clear only if this turn's subtitle is still the one showing.
              setTimeout(() => {
                setPeers((prev) => {
                  const entry = prev.get(d.speakerSocketId) as
                    (PeerState & { _subtitleKey?: string }) | undefined;
                  if (!entry) return prev;
                  if (entry._subtitleKey !== subtitleKey) return prev;
                  const next = new Map(prev);
                  next.set(d.speakerSocketId, { ...entry, subtitle: undefined });
                  return next;
                });
              }, 4000);
            }
            return;
          }

          // Incoming TTS audio frame from a translating peer → ordered sink.
          if (msg.event === 'conference.translation.audio') {
            const d = msg.data as {
              speakerSocketId: string;
              sampleRate: number;
              sequence: number;
              payload: string;
            };
            audioSinkRef.current?.push(d.speakerSocketId, d.sequence, d.sampleRate, d.payload);
            return;
          }

          // In-meeting chat. The gateway translates one sent message per
          // recipient and echoes the original to the sender; `text` here is
          // already in this client's language. Append bounded, same as web.
          if (msg.event === 'conference.chat.message') {
            const d = msg.data as ConferenceChatMessage & { error?: string };
            if (d.error) return;
            setMessages((prev) => {
              const next = [...prev, d];
              return next.length > CHAT_MESSAGE_CAP
                ? next.slice(next.length - CHAT_MESSAGE_CAP)
                : next;
            });
          }
        };
        ws.addEventListener('message', onMessage);

        // Live translation: play incoming TTS in order (sink) and stream our own
        // mic to /ws/translate (bridge). Both are torn down on leave/reconnect.
        audioSinkRef.current = new NativeTranslationAudioSink();
        const token = tokenRef.current;
        if (token && joinResp.socketId) {
          try {
            translateBridgeRef.current = await startTranslateBridge({
              confWs: ws,
              capture: new NativeAudioCapture(),
              socketId: joinResp.socketId,
              speakerDisplayName: displayName,
              sourceLanguage,
              translateUrl: TRANSLATE_WS_URL,
              subprotocol: WS_SUBPROTOCOL,
              token,
              setLocalTranslating,
              log: (m) => console.log(m),
            });
            // Carry the mute state across a reconnect: a user muted before the
            // drop must not resume being transcribed on the fresh bridge.
            if (localMutedRef.current) translateBridgeRef.current.setPaused(true);
          } catch (bridgeErr) {
            // A capture failure (e.g. mic contention with webrtc) must not drop
            // the video call — the call stays up, translation just doesn't start.
            console.error('[conference] translate bridge failed to start', bridgeErr);
          }
        }
      } catch (err) {
        if (onMessage) ws.removeEventListener('message', onMessage);
        setErrorReason('generic');
        setStatus('error');
        // Surface the cause in the dev console; the UI shows the generic state.
        console.error('[conference] join failed', err);
      }
    },
    [roomId, displayName, sourceLanguage, onTrack],
  );

  /**
   * Open a fresh WebSocket, run the join sequence, and wire the close handler to
   * retry (bounded backoff) or give up. Reused on each reconnect attempt.
   */
  const openAndJoin = useCallback(
    (token: string) => {
      if (wsRef.current) {
        const prev = wsRef.current;
        wsRef.current = null;
        prev.close(1000, 'reconnecting');
      }
      const ws = new WebSocket(WS_URL, [WS_SUBPROTOCOL, token]);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        void runJoinSequence(ws);
      });

      ws.addEventListener('close', () => {
        if (intentionalLeaveRef.current) return;

        const attempt = reconnectAttemptRef.current + 1;
        if (attempt <= RECONNECT_CAP) {
          reconnectAttemptRef.current = attempt;
          setReconnectAttempt(attempt);
          setStatus('reconnecting');
          const delay = RECONNECT_BACKOFF_MS[attempt - 1] ?? 4000;
          setTimeout(() => {
            if (intentionalLeaveRef.current) return;
            teardownMediaResources();
            openAndJoin(token);
          }, delay);
        } else {
          teardownMediaResources();
          setErrorReason('connection-lost');
          setStatus('disconnected');
        }
      });

      ws.addEventListener('error', () => {
        // The close handler drives recovery; swallow to avoid an unhandled event.
      });
    },
    [runJoinSequence, teardownMediaResources],
  );

  const join = useCallback(async () => {
    if (!displayName.trim()) return;
    setStatus('connecting');
    setErrorReason(undefined);

    await requestAndroidPermissions();

    let token: string;
    try {
      token = await getToken();
    } catch {
      setErrorReason('not-authenticated');
      setStatus('error');
      return;
    }
    if (!token) {
      setErrorReason('not-authenticated');
      setStatus('error');
      return;
    }
    tokenRef.current = token;

    intentionalLeaveRef.current = false;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);

    openAndJoin(token);
  }, [displayName, getToken, openAndJoin]);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    // Stop capture + translate socket and close the playback sink first so the
    // mic and all AudioContexts are released before the signaling socket drops.
    void translateBridgeRef.current?.stop();
    translateBridgeRef.current = null;
    audioSinkRef.current?.close();
    audioSinkRef.current = null;
    tokenRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    deviceRef.current = null;
    peerNamesRef.current.clear();
    mySocketIdRef.current = null;
    const prev = localStreamRef.current;
    if (prev) prev.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localMutedRef.current = false;
    localVideoEnabledRef.current = true;
    setLocalTranslating(false);
    setLocalStream(null);
    setLocalMuted(false);
    setLocalVideoEnabled(true);
    setPeers((prev2) => {
      prev2.forEach((p) => p.stream.getTracks().forEach((t) => t.stop()));
      return new Map();
    });
    setMySocketId(null);
    setMessages([]);
    setErrorReason(undefined);
    setStatus('idle');
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !localMutedRef.current;
    localMutedRef.current = nextMuted;
    setLocalMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    // Mute must also stop the translation recorder, not just the WebRTC track —
    // otherwise a muted user is still transcribed and translated (privacy).
    translateBridgeRef.current?.setPaused(nextMuted);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.mute', { muted: nextMuted });
    }
  }, []);

  const toggleVideo = useCallback(() => {
    const nextVideo = !localVideoEnabledRef.current;
    localVideoEnabledRef.current = nextVideo;
    setLocalVideoEnabled(nextVideo);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = nextVideo));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.video', { videoEnabled: nextVideo });
    }
  }, []);

  // react-native-audio-api has no browser autoplay policy, so incoming TTS plays
  // as soon as a frame arrives — there is nothing to unlock. `resumeAudio` stays
  // in the contract for parity with web (and `audioBlocked` stays false on RN).
  const resumeAudio = useCallback(async () => {
    /* No-op on RN: no autoplay gate to release. */
  }, []);
  /**
   * Send an in-meeting chat message. The gateway translates it per recipient
   * and echoes the original back, which arrives via `conference.chat.message`.
   * No-op for blank text or a closed socket.
   */
  const sendChat = useCallback((text: string) => {
    if (!text.trim()) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.chat', { text });
    }
  }, []);

  // Close on unmount so a backgrounded/killed screen never leaks a socket,
  // camera, mic, or AudioContext.
  useEffect(
    () => () => {
      intentionalLeaveRef.current = true;
      void translateBridgeRef.current?.stop();
      translateBridgeRef.current = null;
      audioSinkRef.current?.close();
      audioSinkRef.current = null;
      wsRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
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
    audioBlocked: false,
    localTranslating,
    reconnectAttempt,
    reconnectCap: RECONNECT_CAP,
    join,
    leave,
    toggleMute,
    toggleVideo,
    resumeAudio,
    messages,
    sendChat,
  };
}
