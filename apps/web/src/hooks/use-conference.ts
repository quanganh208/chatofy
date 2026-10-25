'use client';

/**
 * React state for one mediasoup conference room.
 *
 * The call itself — sockets, reconnects, media, the translate leg, room events —
 * lives in `ConferenceConnection` (`src/conference/`). This hook owns only what
 * the screen renders, and makes sure a call never outlives the component: an
 * unmount leaves the room, which stops the camera, the microphone and the
 * translate session.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSession } from 'next-auth/react';
import type { LanguageCode } from '@chatofy/types';
import { ConferenceConnection } from '@/conference/conference-connection';
import { RECONNECT_CAP } from '@/conference/conference-connection-policy';
import { conferenceSocketBaseUrl } from '@/conference/conference-socket-url';
import { env } from '@/config/env';
import type {
  ConferenceChatMessage,
  ConferenceChatRefusal,
  ConferenceErrorReason,
  ConferenceSink,
  ConferenceStatus,
  PeerState,
} from '@/conference/conference-types';

export type {
  ConferenceChatMessage,
  ConferenceChatRefusal,
  ConferenceErrorReason,
  ConferenceStatus,
  PeerState,
} from '@/conference/conference-types';

const API_WS_URL = conferenceSocketBaseUrl(env.NEXT_PUBLIC_API_BASE_URL);

/** Max chat messages retained per meeting (ephemeral, bounded). */
const CHAT_MESSAGE_CAP = 200;

export interface UseConferenceReturn {
  status: ConferenceStatus;
  /**
   * Present when `status === 'error'` or `'disconnected'`, and as the soft
   * `'audio-only'` notice while in the call. Undefined otherwise.
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
   * autoplay policy). The page offers "tap to enable sound" while true.
   */
  audioBlocked: boolean;
  /** True while the local speaker's current subtitle turn is open. */
  localTranslating: boolean;
  /** Current reconnect attempt (1-based); 0 when not reconnecting. */
  reconnectAttempt: number;
  /** Maximum reconnect attempts before giving up to `disconnected`. */
  reconnectCap: number;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  /** Resume all suspended TTS AudioContexts. Must be called from a user gesture. */
  resumeAudio: () => Promise<void>;
  /** In-meeting chat, each message already in this client's language. Bounded. */
  messages: ConferenceChatMessage[];
  /** Send a chat message. No-op for blank/whitespace-only text. */
  sendChat: (text: string) => void;
  /**
   * Why the server refused the last message sent, until the next send. Null
   * when nothing was refused.
   */
  chatRefusal: ConferenceChatRefusal | null;
}

async function currentAccessToken(): Promise<string | undefined> {
  return (await getSession())?.accessToken;
}

/** Send the browser to sign-in and back here afterwards. */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?callbackUrl=${callbackUrl}`);
}

export function useConference(
  roomId: string,
  options: { displayName: string; sourceLanguage: LanguageCode },
): UseConferenceReturn {
  const { displayName, sourceLanguage } = options;

  const [status, setStatusValue] = useState<ConferenceStatus>('idle');
  const [errorReason, setErrorReason] = useState<ConferenceErrorReason | undefined>(undefined);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [localTranslating, setLocalTranslating] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [messages, setMessages] = useState<ConferenceChatMessage[]>([]);
  const [chatRefusal, setChatRefusal] = useState<ConferenceChatRefusal | null>(null);

  const connectionRef = useRef<ConferenceConnection | null>(null);
  const localMutedRef = useRef(false);
  const localVideoEnabledRef = useRef(true);

  // Every member is a stable state setter, so one sink serves every connection.
  const sink = useMemo<ConferenceSink>(
    () => ({
      status(next, reason) {
        setStatusValue(next);
        setErrorReason(reason);
      },
      reconnectAttempt: setReconnectAttempt,
      selfSocketId: setMySocketId,
      localStream: setLocalStream,
      peers: setPeers,
      audioBlocked: setAudioBlocked,
      translating: setLocalTranslating,
      chat(message) {
        setMessages((prev) => {
          const next = [...prev, message];
          return next.length > CHAT_MESSAGE_CAP ? next.slice(-CHAT_MESSAGE_CAP) : next;
        });
      },
      chatRefused: setChatRefusal,
      unauthenticated: redirectToLogin,
    }),
    [],
  );

  const join = useCallback((): Promise<void> => {
    if (!displayName.trim()) return Promise.resolve();
    connectionRef.current?.leave();
    const connection = new ConferenceConnection({
      wsBaseUrl: API_WS_URL,
      roomId,
      displayName: displayName.trim(),
      sourceLanguage,
      getToken: currentAccessToken,
      sink,
    });
    connectionRef.current = connection;
    connection.setMuted(localMutedRef.current);
    connection.setVideoEnabled(localVideoEnabledRef.current);
    connection.start();
    return Promise.resolve();
  }, [roomId, displayName, sourceLanguage, sink]);

  const leave = useCallback(() => {
    connectionRef.current?.leave();
    connectionRef.current = null;
    localMutedRef.current = false;
    localVideoEnabledRef.current = true;
    setLocalMuted(false);
    setLocalVideoEnabled(true);
    setMessages([]);
    setChatRefusal(null);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !localMutedRef.current;
    localMutedRef.current = next;
    setLocalMuted(next);
    connectionRef.current?.setMuted(next);
  }, []);

  const toggleVideo = useCallback(() => {
    const next = !localVideoEnabledRef.current;
    localVideoEnabledRef.current = next;
    setLocalVideoEnabled(next);
    connectionRef.current?.setVideoEnabled(next);
  }, []);

  const sendChat = useCallback((text: string) => {
    if (!text.trim()) return;
    setChatRefusal(null);
    connectionRef.current?.sendChat(text);
  }, []);

  const resumeAudio = useCallback(async () => {
    await connectionRef.current?.resumeAudio();
  }, []);

  // A call never outlives the screen: navigating away leaves the room, which
  // stops the local tracks and the translate session with it.
  useEffect(
    () => () => {
      connectionRef.current?.leave();
      connectionRef.current = null;
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
    chatRefusal,
  };
}
