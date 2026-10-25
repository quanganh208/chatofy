/**
 * React Native conference hook — the mobile parallel of web's `useConference`,
 * exposing the same `UseConferenceReturn` surface so the call screen reads what
 * web reads.
 *
 * This file owns the call lifecycle: connect (a fresh token per attempt), the
 * join sequence, bounded reconnect, final endings (room ended, socket replaced,
 * refused join), mic/cam/leave and teardown. The pieces it composes live beside
 * it: request/reply signaling and transport wiring (conference-signaling.ts), the
 * room-event listener (conference-room-events.ts), the peer map updates
 * (conference-peer-state.ts), the ending rules (conference-call-outcome.ts), the
 * translate bridge and the TTS sink. The mediasoup ↔ react-native-webrtc track
 * type mismatch is contained in native-media-adapter.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerGlobals, mediaDevices, type MediaStream } from 'react-native-webrtc';
import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { WS_SUBPROTOCOL, conferenceRoomIdSchema } from '@chatofy/types/events';
import type { ConferenceChatMessage } from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types/domain';
import { toMediasoupTrack } from './native-media-adapter';
import { NativeTranslationAudioSink } from './native-audio-playback';
import { NativeAudioCapture } from './native-audio-capture';
import { startTranslateBridge, type TranslateBridge } from './translate-bridge-native';
import { CONFERENCE_WS_URL, TRANSLATE_WS_URL } from './conference-config';
import {
  ConferenceRequestError,
  request,
  requestAndroidPermissions,
  send,
  wireRecvTransport,
  wireSendTransport,
} from './conference-signaling';
import { createRoomEventListener, type RoomEventListener } from './conference-room-events';
import { withPeerTrack, type PeerMap, type PeerState } from './conference-peer-state';
import {
  finalCloseOutcome,
  joinErrorReason,
  type ConferenceErrorReason,
} from './conference-call-outcome';

export type { PeerState } from './conference-peer-state';
export type { ConferenceErrorReason } from './conference-call-outcome';

// MUST be called once at module load, before any Device is constructed. This installs
// react-native-webrtc's RTCPeerConnection/MediaStream/MediaStreamTrack as the globals
// mediasoup-client reaches for.
registerGlobals();

/** Maximum number of automatic reconnect attempts before giving up. */
const RECONNECT_CAP = 3;
/** Backoff delays (ms) indexed by attempt number (0-based). */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

export type ConferenceStatus =
  'idle' | 'connecting' | 'in-call' | 'error' | 'disconnected' | 'reconnecting';

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
  /** True while one of this speaker's turns is open (speech heard, not yet closed). */
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
  /** In-meeting chat messages in arrival order, each already in this client's language. */
  messages: ConferenceChatMessage[];
  /** Send a chat message. No-op for blank/whitespace-only text or a closed socket. */
  sendChat: (text: string) => void;
}

interface JoinReply {
  socketId: string;
  rtpCapabilities: types.RtpCapabilities;
  peers: { socketId: string; displayName: string; producers: { producerId: string }[] }[];
}

function isJoinReply(data: unknown): data is JoinReply {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<JoinReply>;
  return (
    typeof d.socketId === 'string' &&
    typeof d.rtpCapabilities === 'object' &&
    d.rtpCapabilities !== null &&
    Array.isArray(d.peers)
  );
}

/**
 * Camera + mic, falling back to mic only when the camera is refused or absent.
 * Returns null when even the mic is refused.
 */
async function acquireLocalMedia(): Promise<{ stream: MediaStream; audioOnly: boolean } | null> {
  try {
    const stream = (await mediaDevices.getUserMedia({ audio: true, video: true })) as MediaStream;
    return { stream, audioOnly: false };
  } catch (mediaErr) {
    const name = (mediaErr as Error).name;
    if (
      name !== 'NotAllowedError' &&
      name !== 'PermissionDeniedError' &&
      name !== 'NotFoundError'
    ) {
      throw mediaErr;
    }
  }
  try {
    const stream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
    return { stream, audioOnly: true };
  } catch {
    return null;
  }
}

export function useConferenceNative(
  roomId: string,
  options: { displayName: string; sourceLanguage: LanguageCode; getToken: () => Promise<string> },
): UseConferenceReturn {
  const { displayName, sourceLanguage, getToken } = options;

  const [status, setStatus] = useState<ConferenceStatus>('idle');
  const [errorReason, setErrorReason] = useState<ConferenceErrorReason | undefined>(undefined);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerMap>(new Map());
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const [localTranslating, setLocalTranslating] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [messages, setMessages] = useState<ConferenceChatMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  /** Ordered per-speaker TTS playback sink; created on join, closed on leave. */
  const audioSinkRef = useRef<NativeTranslationAudioSink | null>(null);
  /** Live translate bridge (mic → /ws/translate → broadcast); stopped on leave. */
  const translateBridgeRef = useRef<TranslateBridge | null>(null);
  /** Room-event listener of the current socket. */
  const roomEventsRef = useRef<RoomEventListener | null>(null);
  /** socketId → displayName, known before a PeerState exists (from join/peer.joined). */
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  /** Peers that left; a consume finishing after their departure is discarded. */
  const departedRef = useRef<Set<string>>(new Set());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localMutedRef = useRef(false);
  const localVideoEnabledRef = useRef(true);
  /** Set by leave()/unmount so nothing reconnects after an intentional leave. */
  const intentionalLeaveRef = useRef(false);
  /** Set when the call reached a final state that must not be retried. */
  const terminalRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest `connect`, so the reconnect timer always calls the current closure. */
  const connectRef = useRef<() => Promise<void>>(async () => {});

  /** Upsert a remote track's stream into the peers map. */
  const onTrack = useCallback((socketId: string, stream: MediaStream) => {
    if (departedRef.current.has(socketId)) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const name = peerNamesRef.current.get(socketId) ?? socketId;
    setPeers((prev) => withPeerTrack(prev, socketId, stream, name));
  }, []);

  /**
   * Release all media/transport resources held by a prior attempt so a reconnect
   * (or a final state) starts clean. Does NOT touch wsRef or status.
   */
  const teardownMediaResources = useCallback(() => {
    roomEventsRef.current?.dispose();
    roomEventsRef.current = null;
    peerNamesRef.current.clear();
    departedRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    // Release the translate bridge (recorder + socket) and the playback sink so
    // no mic/AudioContext is left held.
    void translateBridgeRef.current?.stop();
    translateBridgeRef.current = null;
    audioSinkRef.current?.close();
    audioSinkRef.current = null;
    setLocalTranslating(false);
    setLocalStream(null);
    setPeers((prev) => {
      prev.forEach((p) => p.stream.getTracks().forEach((t) => t.stop()));
      return new Map();
    });
    setMySocketId(null);
  }, []);

  const cancelReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /** Move to a final state: release everything, close the socket, never retry. */
  const endCall = useCallback(
    (nextStatus: 'error' | 'disconnected', reason: ConferenceErrorReason) => {
      terminalRef.current = true;
      cancelReconnectTimer();
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      teardownMediaResources();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      setErrorReason(reason);
      setStatus(nextStatus);
    },
    [cancelReconnectTimer, teardownMediaResources],
  );

  /**
   * Run the join sequence on an open socket. Every await is followed by a check
   * that this socket is still the live one, so a drop or leave mid-sequence
   * neither overwrites the newer state nor leaks the camera.
   */
  const runJoinSequence = useCallback(
    async (ws: WebSocket, token: string) => {
      const isCurrent = () =>
        wsRef.current === ws && !intentionalLeaveRef.current && !terminalRef.current;

      try {
        let reply: unknown;
        try {
          reply = await request(ws, 'conference.join', { roomId, displayName, sourceLanguage });
        } catch (err) {
          if (!isCurrent()) return;
          if (err instanceof ConferenceRequestError) {
            endCall('error', joinErrorReason(err.code));
            return;
          }
          throw err;
        }
        if (!isCurrent()) return;
        if (!isJoinReply(reply)) throw new Error('conference.join returned an unexpected shape');
        const joinResp = reply;

        setMySocketId(joinResp.socketId);
        for (const peer of joinResp.peers) {
          peerNamesRef.current.set(peer.socketId, peer.displayName);
        }

        // Listen for room events now: the gateway already counts this peer as
        // in the room, so events can arrive during the rest of the sequence.
        const room = createRoomEventListener({
          ws,
          myLanguage: sourceLanguage,
          mySocketId: joinResp.socketId,
          peerNames: peerNamesRef.current,
          departed: departedRef.current,
          setPeers,
          setMessages,
          audioSink: () => audioSinkRef.current,
          onTrack,
          onEnded: () => endCall('error', 'room-ended'),
        });
        roomEventsRef.current = room;
        ws.addEventListener('message', room.onMessage);
        audioSinkRef.current = new NativeTranslationAudioSink();

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinResp.rtpCapabilities });
        if (!isCurrent()) return;

        const media = await acquireLocalMedia();
        if (!isCurrent()) {
          media?.stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!media) {
          endCall('error', 'permission-denied');
          return;
        }
        const { stream, audioOnly } = media;
        if (audioOnly) setErrorReason('audio-only');
        localStreamRef.current = stream;
        setLocalStream(stream);
        // Re-apply any mute/video state carried across a reconnect.
        stream.getAudioTracks().forEach((t) => (t.enabled = !localMutedRef.current));
        stream.getVideoTracks().forEach((t) => (t.enabled = localVideoEnabledRef.current));

        const sendParams = (await request(ws, 'conference.transport.create', {
          direction: 'send',
        })) as types.TransportOptions;
        if (!isCurrent()) return;
        const sendTransport = device.createSendTransport(sendParams);
        wireSendTransport(ws, sendTransport);
        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track: toMediasoupTrack(track) });
          if (!isCurrent()) return;
        }

        const recvParams = (await request(ws, 'conference.transport.create', {
          direction: 'recv',
        })) as types.TransportOptions;
        if (!isCurrent()) return;
        const recvTransport = device.createRecvTransport(recvParams);
        wireRecvTransport(ws, recvTransport);

        // Consume the peers already producing when we joined, then anything
        // announced while the sequence ran.
        room.attachMedia(
          device,
          recvTransport,
          joinResp.peers.flatMap((peer) =>
            peer.producers.map((p) => ({ producerId: p.producerId, socketId: peer.socketId })),
          ),
        );

        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setStatus('in-call');

        // Live translation of our own mic. A capture failure (e.g. mic contention
        // with webrtc) must not drop the video call — translation just doesn't start.
        try {
          const bridge = await startTranslateBridge({
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
          if (!isCurrent()) {
            void bridge.stop();
            return;
          }
          translateBridgeRef.current = bridge;
          // Carry the mute state across a reconnect: a user muted before the
          // drop must not resume being transcribed on the fresh bridge.
          if (localMutedRef.current) bridge.setPaused(true);
        } catch (bridgeErr) {
          console.error('[conference] translate bridge failed to start', bridgeErr);
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('[conference] join failed', err);
        endCall('error', 'generic');
      }
    },
    [roomId, displayName, sourceLanguage, onTrack, endCall],
  );

  /**
   * One connection attempt: fetch a fresh token (a reconnect late in a call must
   * not present the first, expired one), open the socket, run the join, and on an
   * unexpected close retry with bounded backoff.
   */
  const connect = useCallback(async () => {
    let token: string;
    try {
      token = await getToken();
      if (!token) throw new Error('empty token');
    } catch {
      if (!intentionalLeaveRef.current && !terminalRef.current) {
        endCall('error', 'not-authenticated');
      }
      return;
    }
    if (intentionalLeaveRef.current || terminalRef.current) return;

    const ws = new WebSocket(CONFERENCE_WS_URL, [WS_SUBPROTOCOL, token]);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      if (wsRef.current === ws) void runJoinSequence(ws, token);
    });

    ws.addEventListener('close', (evt: { code?: number }) => {
      // A socket we already replaced or ended is not this call's concern.
      if (wsRef.current !== ws) return;
      if (intentionalLeaveRef.current || terminalRef.current) return;

      const final = finalCloseOutcome(evt.code ?? 0);
      if (final) {
        endCall(final.status, final.reason);
        return;
      }

      wsRef.current = null;
      const attempt = reconnectAttemptRef.current + 1;
      if (attempt > RECONNECT_CAP) {
        endCall('disconnected', 'connection-lost');
        return;
      }
      reconnectAttemptRef.current = attempt;
      setReconnectAttempt(attempt);
      setStatus('reconnecting');
      teardownMediaResources();
      const delay = RECONNECT_BACKOFF_MS[attempt - 1] ?? 4000;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (intentionalLeaveRef.current || terminalRef.current) return;
        void connectRef.current();
      }, delay);
    });

    ws.addEventListener('error', () => {
      // The close handler drives recovery; swallow to avoid an unhandled event.
    });
  }, [getToken, runJoinSequence, endCall, teardownMediaResources]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const join = useCallback(async () => {
    if (!displayName.trim()) return;
    setStatus('connecting');
    setErrorReason(undefined);
    intentionalLeaveRef.current = false;
    terminalRef.current = false;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);

    // Only an id `POST /conference` minted can name a room; a malformed one from a
    // deep link is answered here instead of with the gateway's generic refusal.
    if (!conferenceRoomIdSchema.safeParse(roomId).success) {
      endCall('error', 'room-not-found');
      return;
    }

    await requestAndroidPermissions();
    await connect();
  }, [roomId, displayName, connect, endCall]);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    cancelReconnectTimer();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    // Stop capture + translate socket and close the playback sink first so the
    // mic and all AudioContexts are released before the signaling socket drops.
    teardownMediaResources();
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    localMutedRef.current = false;
    localVideoEnabledRef.current = true;
    setLocalMuted(false);
    setLocalVideoEnabled(true);
    setMessages([]);
    setErrorReason(undefined);
    setStatus('idle');
  }, [cancelReconnectTimer, teardownMediaResources]);

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
  // as soon as a frame arrives — there is nothing to unlock.
  const resumeAudio = useCallback(async () => {
    /* No-op on RN: no autoplay gate to release. */
  }, []);

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
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      roomEventsRef.current?.dispose();
      void translateBridgeRef.current?.stop();
      translateBridgeRef.current = null;
      audioSinkRef.current?.close();
      audioSinkRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
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
