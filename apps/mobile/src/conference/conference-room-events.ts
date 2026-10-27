/**
 * The room-event listener for one conference socket.
 *
 * It is attached the moment the join reply arrives — before getUserMedia,
 * before anything is published — because the gateway adds this peer to the room
 * before it replies, so `peer.joined`, `media.published` and the rest can arrive
 * while the join sequence is still running. The receive side already exists by
 * then, so every event applies immediately.
 */

import type { Dispatch, SetStateAction } from 'react';
import {
  ConferenceChatMessageSchema,
  ConferenceMediaPublishedSchema,
  ConferenceTranslationAudioSchema,
  ConferenceTranslationSubtitleSchema,
  type ConferenceChatMessage,
  type ConferenceTranslationSubtitle,
} from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types/domain';
import { parseSignal, replyErrorCode } from './conference-signaling';
import {
  withPeerMediaState,
  withPeerSubtitle,
  withoutPeer,
  withoutPeerSubtitle,
  type PeerMap,
} from './conference-peer-state';
import type { NativeTranslationAudioSink } from './native-audio-playback';
import { peerSourceLanguage } from './conference-room-peer-language';
import { SubtitleTurnOrder } from './subtitle-turn-order';

/** How long a closed turn's subtitle stays on the tile. */
const SUBTITLE_LINGER_MS = 4000;

/** Max chat messages retained per meeting (ephemeral, bounded). Same as web. */
const CHAT_MESSAGE_CAP = 200;

export interface RoomEventDeps {
  /** The language this listener speaks; picks which subtitle text to show. */
  myLanguage: LanguageCode;
  mySocketId: string;
  /** socketId → displayName, known before a tile exists. Shared with the hook. */
  peerNames: Map<string, string>;
  /** Peers that left; a track received for one of them afterwards is discarded. */
  departed: Set<string>;
  setPeers: Dispatch<SetStateAction<PeerMap>>;
  setMessages: Dispatch<SetStateAction<ConferenceChatMessage[]>>;
  audioSink: () => NativeTranslationAudioSink | null;
  /** A remote peer published; bring the receive connection up to date. */
  onPublished: () => void;
  /** A remote peer left; forget the receiving mids it owned. */
  onPeerLeft: (socketId: string) => void;
  /** A peer joined speaking `language`, or left (`undefined`; also when the server did not say). */
  onPeerLanguage: (socketId: string, language: LanguageCode | undefined) => void;
  /** The gateway refused one of this speaker's translation broadcasts. */
  onRelayError: (code: string) => void;
  /** The owner ended the meeting. */
  onEnded: () => void;
  /** The gateway refused a chat message this client sent; `code` is its error code. */
  onChatRefused: (code: string) => void;
}

export interface RoomEventListener {
  /** Pass to `ws.addEventListener('message', …)`. */
  onMessage: (evt: MessageEvent<string>) => void;
  /** Cancel pending subtitle timers. */
  dispose: () => void;
}

/**
 * The text a listener reads for one subtitle frame: what was said when the
 * speaker shares the listener's language, otherwise the translation. A
 * cross-language listener sees nothing until translated text exists, rather
 * than a provisional line in a language they did not choose.
 */
function subtitleTextFor(
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
  const { myLanguage, mySocketId, peerNames, departed, setPeers, setMessages } = deps;
  const subtitleTimers = new Set<ReturnType<typeof setTimeout>>();
  const turnOrder = new SubtitleTurnOrder();
  let disposed = false;

  function onSubtitle(data: unknown): void {
    const parsed = ConferenceTranslationSubtitleSchema.safeParse(data);
    if (!parsed.success) return;
    const subtitle = parsed.data;
    const speaker = subtitle.speakerSocketId;
    if (!speaker || speaker === mySocketId) return;

    const text = subtitleTextFor(subtitle, myLanguage);
    // A speaker's turns overlap; once a newer one is on screen, an older one's
    // frames (its late final included) must not take the line back.
    if (!turnOrder.accept(speaker, subtitle.turnId, text.length > 0)) return;
    if (text.length > 0) {
      setPeers((prev) => withPeerSubtitle(prev, speaker, subtitle.turnId, text));
    } else if (!subtitle.isFinal) {
      // An empty non-final frame is the speaker's way of saying this turn ended
      // with no final (no speech, or the turn failed): take its line down now.
      setPeers((prev) => withoutPeerSubtitle(prev, speaker, subtitle.turnId));
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
      case 'conference.media.published': {
        const parsed = ConferenceMediaPublishedSchema.safeParse(msg.data);
        if (!parsed.success || parsed.data.socketId === mySocketId) return;
        deps.onPublished();
        return;
      }
      case 'conference.peer.joined': {
        const socketId = stringField(msg.data, 'socketId');
        const displayName = stringField(msg.data, 'displayName');
        if (!socketId) return;
        departed.delete(socketId);
        peerNames.set(socketId, displayName ?? socketId);
        deps.onPeerLanguage(socketId, peerSourceLanguage(msg.data));
        return;
      }
      case 'conference.peer.left': {
        const socketId = stringField(msg.data, 'socketId');
        if (!socketId) return;
        departed.add(socketId);
        peerNames.delete(socketId);
        turnOrder.forget(socketId);
        deps.onPeerLanguage(socketId, undefined);
        deps.audioSink()?.removeSpeaker(socketId);
        deps.onPeerLeft(socketId);
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
      // A refused `conference.chat` comes back on the same event name.
      case 'conference.chat': {
        const code = replyErrorCode(msg.data);
        if (code) deps.onChatRefused(code);
        return;
      }
      // A refused `conference.translation.broadcast` comes back on its own name.
      case 'conference.translation.broadcast': {
        const code = replyErrorCode(msg.data);
        if (code) deps.onRelayError(code);
        return;
      }
      case 'conference.ended':
        deps.onEnded();
        return;
      default:
        return;
    }
  };

  return {
    onMessage,
    dispose() {
      disposed = true;
      for (const timer of subtitleTimers) clearTimeout(timer);
      subtitleTimers.clear();
    },
  };
}
