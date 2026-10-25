/**
 * The room-event listener for one conference socket.
 *
 * It is attached the moment the join reply arrives — before the device loads,
 * before getUserMedia, before any transport exists — because the gateway adds
 * this peer to the room before it replies, so `peer.joined`, `new.producer` and
 * the rest can arrive while the join sequence is still running. Producers
 * announced before the receive transport exists are queued and consumed once
 * {@link RoomEventListener.attachMedia} supplies it; everything else applies
 * immediately.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { MediaStream } from 'react-native-webrtc';
import type { types } from 'mediasoup-client';
import {
  ConferenceChatMessageSchema,
  ConferenceTranslationAudioSchema,
  ConferenceTranslationSubtitleSchema,
  type ConferenceChatMessage,
  type ConferenceTranslationSubtitle,
} from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types/domain';
import { consumeTrack, parseSignal } from './conference-signaling';
import {
  withPeerMediaState,
  withPeerSubtitle,
  withoutPeer,
  withoutPeerSubtitle,
  type PeerMap,
} from './conference-peer-state';
import type { NativeTranslationAudioSink } from './native-audio-playback';

/** How long a closed turn's subtitle stays on the tile. */
const SUBTITLE_LINGER_MS = 4000;

/** Max chat messages retained per meeting (ephemeral, bounded). Same as web. */
export const CHAT_MESSAGE_CAP = 200;

export interface RoomEventDeps {
  ws: WebSocket;
  /** The language this listener speaks; picks which subtitle text to show. */
  myLanguage: LanguageCode;
  mySocketId: string;
  /** socketId → displayName, known before a tile exists. Shared with the hook. */
  peerNames: Map<string, string>;
  /** Peers that left; a track consumed for one of them afterwards is discarded. */
  departed: Set<string>;
  setPeers: Dispatch<SetStateAction<PeerMap>>;
  setMessages: Dispatch<SetStateAction<ConferenceChatMessage[]>>;
  audioSink: () => NativeTranslationAudioSink | null;
  onTrack: (socketId: string, stream: MediaStream) => void;
  /** The owner ended the meeting. */
  onEnded: () => void;
}

export interface ProducerRef {
  producerId: string;
  socketId: string;
}

export interface RoomEventListener {
  /** Pass to `ws.addEventListener('message', …)`. */
  onMessage: (evt: MessageEvent<string>) => void;
  /**
   * Supply the receive side once it exists, then consume `initial` (the join
   * reply's producers) and every producer announced in the meantime.
   */
  attachMedia: (
    device: types.Device,
    recvTransport: types.Transport,
    initial: ProducerRef[],
  ) => void;
  /** Cancel pending subtitle timers. */
  dispose: () => void;
}

/**
 * The text a listener reads for one subtitle frame: what was said when the
 * speaker shares the listener's language, otherwise the translation. A
 * cross-language listener sees nothing until translated text exists, rather
 * than a provisional line in a language they did not choose.
 */
export function subtitleTextFor(
  subtitle: Pick<ConferenceTranslationSubtitle, 'sourceLanguage' | 'sourceText' | 'translatedText'>,
  myLanguage: LanguageCode,
): string {
  return subtitle.sourceLanguage === myLanguage ? subtitle.sourceText : subtitle.translatedText;
}

function stringField(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function booleanField(data: unknown, key: string): boolean | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function createRoomEventListener(deps: RoomEventDeps): RoomEventListener {
  const { ws, myLanguage, mySocketId, peerNames, departed, setPeers, setMessages } = deps;
  let media: { device: types.Device; recvTransport: types.Transport } | null = null;
  const pendingProducers: ProducerRef[] = [];
  // A producer can be both in the join reply and announced while the sequence
  // ran; consume it once.
  const consumedProducers = new Set<string>();
  const subtitleTimers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  function consume(producerId: string, socketId: string): void {
    if (!media || departed.has(socketId) || consumedProducers.has(producerId)) return;
    consumedProducers.add(producerId);
    consumeTrack(ws, media.device, media.recvTransport, producerId, socketId, deps.onTrack).catch(
      (err: unknown) => console.warn('[conference] consume failed', producerId, err),
    );
  }

  function onSubtitle(data: unknown): void {
    const parsed = ConferenceTranslationSubtitleSchema.safeParse(data);
    if (!parsed.success) return;
    const subtitle = parsed.data;
    const speaker = subtitle.speakerSocketId;
    if (!speaker || speaker === mySocketId) return;

    const text = subtitleTextFor(subtitle, myLanguage);
    if (text.length > 0) {
      setPeers((prev) => withPeerSubtitle(prev, speaker, subtitle.turnId, text));
    }
    if (subtitle.isFinal) {
      const timer = setTimeout(() => {
        subtitleTimers.delete(timer);
        if (disposed) return;
        setPeers((prev) => withoutPeerSubtitle(prev, speaker, subtitle.turnId));
      }, SUBTITLE_LINGER_MS);
      subtitleTimers.add(timer);
    }
  }

  function onAudio(data: unknown): void {
    const parsed = ConferenceTranslationAudioSchema.safeParse(data);
    if (!parsed.success) return;
    const audio = parsed.data;
    if (!audio.speakerSocketId || audio.speakerSocketId === mySocketId) return;
    deps.audioSink()?.push(audio.speakerSocketId, audio.sequence, audio.sampleRate, audio.payload);
  }

  function onChat(data: unknown): void {
    const parsed = ConferenceChatMessageSchema.safeParse(data);
    if (!parsed.success) return;
    setMessages((prev) => {
      const next = [...prev, parsed.data];
      return next.length > CHAT_MESSAGE_CAP ? next.slice(next.length - CHAT_MESSAGE_CAP) : next;
    });
  }

  const onMessage = (evt: MessageEvent<string>): void => {
    if (disposed) return;
    const msg = parseSignal(evt.data);
    if (!msg) return;

    switch (msg.event) {
      case 'conference.new.producer': {
        const producerId = stringField(msg.data, 'producerId');
        const socketId = stringField(msg.data, 'socketId');
        if (!producerId || !socketId || socketId === mySocketId) return;
        if (media) consume(producerId, socketId);
        else pendingProducers.push({ producerId, socketId });
        return;
      }
      case 'conference.peer.joined': {
        const socketId = stringField(msg.data, 'socketId');
        const displayName = stringField(msg.data, 'displayName');
        if (!socketId) return;
        departed.delete(socketId);
        peerNames.set(socketId, displayName ?? socketId);
        return;
      }
      case 'conference.peer.left': {
        const socketId = stringField(msg.data, 'socketId');
        if (!socketId) return;
        departed.add(socketId);
        peerNames.delete(socketId);
        deps.audioSink()?.removeSpeaker(socketId);
        setPeers((prev) => withoutPeer(prev, socketId));
        return;
      }
      case 'conference.participant.state': {
        const socketId = stringField(msg.data, 'socketId');
        if (!socketId) return;
        const muted = booleanField(msg.data, 'muted');
        const videoEnabled = booleanField(msg.data, 'videoEnabled');
        setPeers((prev) => withPeerMediaState(prev, socketId, { muted, videoEnabled }));
        return;
      }
      case 'conference.translation.subtitle':
        onSubtitle(msg.data);
        return;
      case 'conference.translation.audio':
        onAudio(msg.data);
        return;
      // The gateway translates one sent message per recipient and echoes the
      // original to the sender; `text` is already in this client's language.
      case 'conference.chat.message':
        onChat(msg.data);
        return;
      case 'conference.ended':
        deps.onEnded();
        return;
      default:
        return;
    }
  };

  return {
    onMessage,
    attachMedia(device, recvTransport, initial) {
      if (disposed) return;
      media = { device, recvTransport };
      for (const p of [...initial, ...pendingProducers.splice(0)]) {
        consume(p.producerId, p.socketId);
      }
    },
    dispose() {
      disposed = true;
      pendingProducers.length = 0;
      for (const timer of subtitleTimers) clearTimeout(timer);
      subtitleTimers.clear();
    },
  };
}
