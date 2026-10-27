/**
 * React Native conference hook — the mobile parallel of web's `useConference`,
 * exposing the same `UseConferenceReturn` surface so the call screen reads what
 * web reads.
 *
 * This file owns the call lifecycle: connect (a fresh token per attempt), the
 * join sequence, bounded reconnect, final endings (room ended, socket replaced,
 * refused join), mic/cam/leave and teardown. The pieces it composes live beside
 * it: request/reply signaling and the SFU publish/subscribe steps
 * (conference-signaling.ts), the room-event listener (conference-room-events.ts),
 * the peer map updates (conference-peer-state.ts), the ending rules
 * (conference-call-outcome.ts), the speaker's translation leg and the TTS sink.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { mediaDevices, type MediaStream, type RTCPeerConnection } from 'react-native-webrtc';
import {
  ConferenceIceServerSchema,
  WS_SUBPROTOCOL,
  conferenceRoomIdSchema,
} from '@chatofy/types/events';
import type { ConferenceChatMessage, ConferenceIceServer } from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types/domain';
import { NativeTranslationAudioSink } from './native-audio-playback';
import type { ConferenceCascadeLeg } from '@chatofy/realtime-client';
import {
  createNativeConferenceLeg,
  drainLegThenClose,
  releaseCapture,
} from './conference-cascade-leg-native';
import { NativeAudioCapture } from './native-audio-capture';
import { PeerLanguages, peerSourceLanguage } from './conference-room-peer-language';
import { CONFERENCE_WS_URL } from './conference-config';
import {
  ConferenceRequestError,
  createSfuPeerConnection,
  createSfuSubscriber,
  publishLocalTracks,
  request,
  requestAndroidPermissions,
  send,
  type SfuSubscriber,
} from './conference-signaling';
import { createRoomEventListener, type RoomEventListener } from './conference-room-events';
import { withPeerTrack, type PeerMap, type PeerState } from './conference-peer-state';
import {
  finalCloseOutcome,
  chatRefusal,
  joinRefusalOutcome,
  type ChatRefusal,
  type ConferenceErrorReason,
} from './conference-call-outcome';

export type { PeerState } from './conference-peer-state';

/** Maximum number of automatic reconnect attempts before giving up. */
const RECONNECT_CAP = 3;
/** Backoff delays (ms) indexed by attempt number (0-based). */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

type ConferenceStatus =
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
  /**
   * The speaker's translation ended for good mid-call (no token, refused, or the
   * translator kept dropping); cleared when the call view resets.
   */
  translationEnded: boolean;
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
  /** Set when the gateway refused the last chat message; cleared by the next send. */
  chatNotice: ChatRefusal | undefined;
}

interface JoinReply {
  socketId: string;
  iceServers: ConferenceIceServer[];
  peers: { socketId: string; displayName: string; published: boolean; sourceLanguage?: unknown }[];
}

const iceServersSchema = ConferenceIceServerSchema.array();

function isJoinReply(data: unknown): data is JoinReply {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<JoinReply>;
  return (
    typeof d.socketId === 'string' &&
    iceServersSchema.safeParse(d.iceServers).success &&
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
  const [translationEnded, setTranslationEnded] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [messages, setMessages] = useState<ConferenceChatMessage[]>([]);
  /** Why the last chat message was refused; cleared by the next send. */
  const [chatNotice, setChatNotice] = useState<ChatRefusal | undefined>(undefined);

  const wsRef = useRef<WebSocket | null>(null);
  /** Ordered per-speaker TTS playback sink; created on join, closed on leave. */
  const audioSinkRef = useRef<NativeTranslationAudioSink | null>(null);
  /** This speaker's translation (mic → /ws/translate cascade → broadcast). */
  const legRef = useRef<ConferenceCascadeLeg | null>(null);
  /**
   * The call's microphone, shared by every leg the call builds. Released — and
   * the iOS audio session with it — only when the call ends, never when a leg
   * rebuilds or the room reconnects.
   */
  const captureRef = useRef<NativeAudioCapture | null>(null);
  /** socketId → spoken language of the others; the leg translates into these. */
  const peerLanguagesRef = useRef(new PeerLanguages((l) => legRef.current?.setRoomLanguages(l)));
  /** Room-event listener of the current socket. */
  const roomEventsRef = useRef<RoomEventListener | null>(null);
  /** socketId → displayName, known before a PeerState exists (from join/peer.joined). */
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  /** Peers that left; a track arriving after their departure is discarded. */
  const departedRef = useRef<Set<string>>(new Set());
  /** The send connection publishing this client's tracks; closed on teardown. */
  const pubPcRef = useRef<RTCPeerConnection | null>(null);
  /** The receive connection and its subscribe chain; closed on teardown. */
  const subscriberRef = useRef<SfuSubscriber | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localMutedRef = useRef(false);
  const localVideoEnabledRef = useRef(true);
  /** The camera was turned off because the app went to the background, not by the user. */
  const pausedForBackgroundRef = useRef(false);
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
   * Release all media/connection resources held by a prior attempt so a
   * reconnect (or a final state) starts clean. Does NOT touch wsRef or status.
   */
  const teardownMediaResources = useCallback(() => {
    roomEventsRef.current?.dispose();
    roomEventsRef.current = null;
    subscriberRef.current?.close();
    subscriberRef.current = null;
    pubPcRef.current?.close();
    pubPcRef.current = null;
    peerNamesRef.current.clear();
    peerLanguagesRef.current.clear();
    departedRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    // A lost socket cannot carry a final any more; a leave detaches and drains the leg first.
    legRef.current?.stop();
    legRef.current = null;
    audioSinkRef.current?.close();
    audioSinkRef.current = null;
    setLocalTranslating(false);
    setTranslationEnded(false);
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
      releaseCapture(captureRef.current);
      captureRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      setErrorReason(reason);
      setStatus(nextStatus);
    },
    [cancelReconnectTimer, teardownMediaResources],
  );

  /**
   * Retry after an unexpected drop or a transient join refusal: bounded backoff,
   * then `disconnected` once the cap is spent. The caller has already detached
   * the failed socket from `wsRef`.
   */
  const scheduleReconnect = useCallback(() => {
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
    cancelReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (intentionalLeaveRef.current || terminalRef.current) return;
      void connectRef.current();
    }, delay);
  }, [endCall, teardownMediaResources, cancelReconnectTimer]);

  /**
   * Run the join sequence on an open socket. Every await is followed by a check
   * that this socket is still the live one, so a drop or leave mid-sequence
   * neither overwrites the newer state nor leaks the camera.
   */
  const runJoinSequence = useCallback(
    async (ws: WebSocket) => {
      const isCurrent = () =>
        wsRef.current === ws && !intentionalLeaveRef.current && !terminalRef.current;

      try {
        let reply: unknown;
        try {
          reply = await request(ws, 'conference.join', { roomId, displayName, sourceLanguage });
        } catch (err) {
          if (!isCurrent()) return;
          if (err instanceof ConferenceRequestError) {
            const outcome = joinRefusalOutcome(err.code);
            if (outcome.retry) {
              // Detach first so this socket's close is not handled as a second drop.
              wsRef.current = null;
              ws.close();
              scheduleReconnect();
            } else {
              endCall('error', outcome.reason);
            }
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
          peerLanguagesRef.current.set(peer.socketId, peerSourceLanguage(peer));
        }

        // The receive side exists before room events are heard, so a
        // `media.published` arriving mid-sequence is subscribed to at once.
        const subscriber = createSfuSubscriber(ws, joinResp.iceServers, onTrack);
        subscriberRef.current = subscriber;

        // Listen for room events now: the gateway already counts this peer as
        // in the room, so events can arrive during the rest of the sequence.
        const room = createRoomEventListener({
          myLanguage: sourceLanguage,
          mySocketId: joinResp.socketId,
          peerNames: peerNamesRef.current,
          departed: departedRef.current,
          setPeers,
          setMessages,
          audioSink: () => audioSinkRef.current,
          onPublished: subscriber.subscribe,
          onPeerLeft: subscriber.dropPeer,
          onPeerLanguage: peerLanguagesRef.current.set,
          onRelayError: (code) => legRef.current?.noteRelayError(code),
          onEnded: () => endCall('error', 'room-ended'),
          onChatRefused: (code) => setChatNotice(chatRefusal(code)),
        });
        roomEventsRef.current = room;
        ws.addEventListener('message', room.onMessage);
        audioSinkRef.current = new NativeTranslationAudioSink();

        // Pull the peers already publishing when we joined; anything announced
        // since then has queued its own subscribe, and a duplicate pulls nothing.
        if (joinResp.peers.some((peer) => peer.published)) subscriber.subscribe();

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

        const pubPc = createSfuPeerConnection(joinResp.iceServers);
        pubPcRef.current = pubPc;
        await publishLocalTracks(ws, pubPc, stream.getTracks());
        if (!isCurrent()) return;
        // The gateway starts every new peer unmuted with the camera on; after a
        // reconnect, tell the room what this user had already turned off.
        if (localMutedRef.current) send(ws, 'conference.participant.mute', { muted: true });
        if (!localVideoEnabledRef.current) {
          send(ws, 'conference.participant.video', { videoEnabled: false });
        }

        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setStatus('in-call');

        // Translation of our own mic. A capture failure (e.g. mic contention with
        // webrtc) must not drop the video call — translation just doesn't start.
        try {
          captureRef.current ??= new NativeAudioCapture();
          const leg = createNativeConferenceLeg({
            confWs: ws,
            capture: captureRef.current,
            getToken,
            sourceLanguage,
            roomLanguages: peerLanguagesRef.current.values(),
            onTranslatingChange: setLocalTranslating,
            onEnded: (reason) => {
              console.log(`[conference] translation ended: ${reason}`);
              // A leg already replaced by a reconnect says nothing about this call.
              if (legRef.current === leg) setTranslationEnded(true);
            },
            // A user muted before a reconnect is not transcribed by the fresh leg.
            muted: localMutedRef.current,
            receivedSounding: () => audioSinkRef.current?.isAnySounding() ?? false,
          });
          legRef.current = leg; // any teardown from here finds and ends it
          await leg.start();
        } catch (legErr) {
          console.error('[conference] translation failed to start', legErr);
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('[conference] join failed', err);
        endCall('error', 'generic');
      }
    },
    [roomId, displayName, sourceLanguage, getToken, onTrack, endCall, scheduleReconnect],
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
      if (wsRef.current === ws) void runJoinSequence(ws);
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
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // The close handler drives recovery; swallow to avoid an unhandled event.
    });
  }, [getToken, runJoinSequence, endCall, scheduleReconnect]);

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
    // Detach the leg so the teardown does not cut it; it drains, then the socket closes.
    const leg = legRef.current;
    legRef.current = null;
    teardownMediaResources();
    const ws = wsRef.current;
    wsRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    drainLegThenClose(leg, ws, capture);
    localMutedRef.current = false;
    localVideoEnabledRef.current = true;
    pausedForBackgroundRef.current = false;
    setLocalMuted(false);
    setLocalVideoEnabled(true);
    setMessages([]);
    setChatNotice(undefined);
    setErrorReason(undefined);
    setStatus('idle');
  }, [cancelReconnectTimer, teardownMediaResources]);

  const toggleMute = useCallback(() => {
    const nextMuted = !localMutedRef.current;
    localMutedRef.current = nextMuted;
    setLocalMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    // Mute must also stop translation (down to the recorder), not just the WebRTC
    // track — otherwise a muted user is still transcribed and translated (privacy).
    if (nextMuted) legRef.current?.pause();
    else legRef.current?.resume();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.mute', { muted: nextMuted });
    }
  }, []);

  const setVideoEnabled = useCallback((nextVideo: boolean) => {
    localVideoEnabledRef.current = nextVideo;
    setLocalVideoEnabled(nextVideo);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = nextVideo));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send(wsRef.current, 'conference.participant.video', { videoEnabled: nextVideo });
    }
  }, []);

  const toggleVideo = useCallback(() => {
    pausedForBackgroundRef.current = false;
    setVideoEnabled(!localVideoEnabledRef.current);
  }, [setVideoEnabled]);

  // In the background the call keeps its microphone (a foreground service, owned
  // by the call screen) but not its camera: Android revokes it anyway, and the
  // others would see a frozen frame. So the camera goes off the way the button
  // turns it off — the roster shows it — and comes back on return only if it was
  // on when the app left.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' && localVideoEnabledRef.current && localStreamRef.current) {
        pausedForBackgroundRef.current = true;
        setVideoEnabled(false);
      } else if (next === 'active' && pausedForBackgroundRef.current) {
        pausedForBackgroundRef.current = false;
        setVideoEnabled(true);
      }
    });
    return () => subscription.remove();
  }, [setVideoEnabled]);

  // react-native-audio-api has no browser autoplay policy, so incoming TTS plays
  // as soon as a frame arrives — there is nothing to unlock.
  const resumeAudio = useCallback(async () => {
    /* No-op on RN: no autoplay gate to release. */
  }, []);

  const sendChat = useCallback((text: string) => {
    if (!text.trim()) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setChatNotice(undefined);
      send(wsRef.current, 'conference.chat', { text });
    } else {
      setChatNotice('not-sent');
    }
  }, []);

  // Close on unmount so a backgrounded/killed screen never leaks a socket,
  // camera, mic, or AudioContext.
  useEffect(
    () => () => {
      intentionalLeaveRef.current = true;
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      roomEventsRef.current?.dispose();
      subscriberRef.current?.close();
      pubPcRef.current?.close();
      audioSinkRef.current?.close();
      audioSinkRef.current = null;
      drainLegThenClose(legRef.current, wsRef.current, captureRef.current);
      captureRef.current = null;
      legRef.current = null;
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
    translationEnded,
    reconnectAttempt,
    reconnectCap: RECONNECT_CAP,
    join,
    leave,
    toggleMute,
    toggleVideo,
    resumeAudio,
    messages,
    sendChat,
    chatNotice,
  };
}
