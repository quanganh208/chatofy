import { Injectable } from '@nestjs/common';
import {
  ConferenceTranslationBroadcastSchema,
  normalizeForSearch,
  type ConferenceTranslationAudio,
  type ConferenceTranslationSubtitle,
  type LanguageCode,
} from '@chatofy/types';
import { ConferencePeerLifecycle } from '../conference-peer-lifecycle.service';
import { TokenBucket } from '../conference-token-bucket';
import type {
  ConferenceRoom,
  ParticipantSession,
} from '../conference-room-registry.service';
import { ConferenceSocketRegistry } from '../conference-socket-registry.service';
import {
  parsePayload,
  sendEvent,
  type ConferenceSocket,
} from '../conference-socket';
import { ConferencePersistenceService } from './conference-persistence.service';
import { ConferenceTranslationRouter } from './conference-translation-router.service';

/**
 * How many finished turn ids each peer remembers for de-duplication. A client
 * sends one final per turn, so only a retried or replayed final can repeat,
 * and it does so straight away.
 */
const REMEMBERED_TURNS_PER_PEER = 256;

const EVENT = 'conference.translation.broadcast';

/**
 * Per-peer relay limits. Every frame a peer sends is fanned out to every other
 * peer, so these bound the egress one socket can cause.
 *
 * Sized from what a cascade speaker really sends. Translated speech arrives in
 * 200 ms frames of 24 kHz pcm16, ≈ 12.8 k base64 chars each, so 64 k chars per
 * second of speech per language. The leg relays each frame as the server
 * delivers it, which is faster than real time: one 8 s turn arrives as a burst
 * of 8 × 64 k ≈ 512 k chars and 40 frames per language it is voiced in.
 *
 * The worst burst is a speaker with every turn in flight in a three-language
 * room: 3 turns (the per-socket turn ceiling) × 2 languages = 6 turns of audio,
 * ≈ 3.07 M chars and 240 frames. Beside it run the cumulative subtitle frames,
 * one per transcript delta, each carrying the source, the primary translation
 * and the map (the primary again plus the extra): up to 4 × 4000 = 16 k chars
 * at the contract's text ceiling, and a few dozen frames per turn. So:
 *
 *  - the character burst is 4 MiB: 3.07 M of audio plus ≈ 1.1 M — some 70
 *    maximum-size subtitle frames — of headroom;
 *  - the frame burst is 400: 240 audio frames plus 160 subtitle deltas;
 *  - the refills stay at 512 k chars and 100 frames a second, four times the
 *    128 k chars a second of two languages spoken in real time, so a speaker
 *    who never pauses drains a burst rather than accumulating one.
 *
 * A real speaker meets neither bound, while a peer looping maximum-size frames
 * meets the character budget within seconds.
 */
export const RELAY_FRAME_BURST = 400;
const RELAY_FRAMES_PER_SECOND = 100;
export const RELAY_CHAR_BURST = 4 * 1024 * 1024;
const RELAY_CHARS_PER_SECOND = 512 * 1024;

/**
 * Relays a speaker's own translated output — subtitles and synthesized speech
 * — to the rest of the room, and stores each finished turn once.
 *
 * The server owns identity: `speakerSocketId`, `speakerDisplayName` and the
 * subtitle's `sourceLanguage` are overwritten with the sending peer's values,
 * so no peer can put words or a voice in another participant's name.
 */
@Injectable()
export class ConferenceTranslationRelay {
  constructor(
    private readonly lifecycle: ConferencePeerLifecycle,
    private readonly sockets: ConferenceSocketRegistry,
    private readonly router: ConferenceTranslationRouter,
    private readonly persistence: ConferencePersistenceService,
  ) {}

  relay(ws: ConferenceSocket, body: unknown): void {
    const input = parsePayload(ConferenceTranslationBroadcastSchema, body);
    if (!input) {
      sendEvent(ws, EVENT, { error: 'invalid_payload' });
      return;
    }
    const resolved = this.lifecycle.resolvePeer(ws);
    if ('error' in resolved) {
      sendEvent(ws, EVENT, resolved);
      return;
    }
    const { room, peer, socketId } = resolved;
    // The map repeats the primary translation; a frame whose two copies
    // disagree would show one listener different words than it stores.
    if (input.subtitle && !mapAgrees(input.subtitle)) {
      sendEvent(ws, EVENT, { error: 'invalid_payload' });
      return;
    }
    if (!withinRelayLimits(peer, frameChars(input))) {
      sendEvent(ws, EVENT, { error: 'limit_reached' });
      return;
    }
    const deliver = (to: string, event: string, data: unknown) =>
      this.sockets.sendTo(to, event, data);

    if (input.subtitle) {
      const subtitle: ConferenceTranslationSubtitle = {
        ...input.subtitle,
        sourceLanguage: peer.sourceLanguage,
        speakerSocketId: socketId,
        speakerDisplayName: peer.displayName,
      };
      this.router.routeSubtitle(room, socketId, subtitle, deliver);
      if (subtitle.isFinal) {
        this.persistFinal(peer, room.id, subtitle, roomLanguages(room));
      }
    }
    if (input.audio) {
      const audio: ConferenceTranslationAudio = {
        ...input.audio,
        speakerSocketId: socketId,
      };
      this.router.routeAudio(room, socketId, audio, deliver);
    }
  }

  /**
   * One row per turn, written from its final frame: the source-channel text
   * in the speaker's language and each translation under its language. Frames
   * before the final are provisional and are never stored; a final repeated
   * for the same turn is dropped.
   *
   * Only translations into a language someone else in the room speaks are
   * kept: the speaker chose what to send, and the room is what bounds what the
   * meeting's record holds.
   */
  private persistFinal(
    peer: ParticipantSession,
    conferenceId: string,
    subtitle: ConferenceTranslationSubtitle,
    present: ReadonlySet<LanguageCode>,
  ): void {
    if (peer.persistedTurnIds.has(subtitle.turnId)) return;
    rememberTurn(peer.persistedTurnIds, subtitle.turnId);

    const sourceText = subtitle.sourceText.trim();
    const translations: Partial<Record<LanguageCode, string>> = {};
    const offered = subtitle.translations ?? {
      [subtitle.targetLanguage]: subtitle.translatedText,
    };
    for (const [language, text] of Object.entries(offered) as [
      LanguageCode,
      string | undefined,
    ][]) {
      const kept = text?.trim();
      if (!kept) continue;
      if (language === subtitle.sourceLanguage || !present.has(language)) {
        continue;
      }
      translations[language] = kept;
    }
    const translated = Object.values(translations);
    if (!sourceText && translated.length === 0) return;

    void this.persistence.recordTurn(peer.participantId, conferenceId, {
      sourceLanguage: subtitle.sourceLanguage,
      sourceText,
      searchText: normalizeForSearch([sourceText, ...translated].join(' ')),
      translations,
    });
  }
}

function rememberTurn(seen: Set<string>, turnId: string): void {
  seen.add(turnId);
  if (seen.size <= REMEMBERED_TURNS_PER_PEER) return;
  // Sets iterate in insertion order, so the first entry is the oldest.
  const oldest = seen.values().next().value;
  if (oldest !== undefined) seen.delete(oldest);
}

/** Every language spoken in the room right now. */
function roomLanguages(room: ConferenceRoom): Set<LanguageCode> {
  return new Set([...room.peers.values()].map((p) => p.sourceLanguage));
}

/** Whether a subtitle's map, when it has one, holds its primary translation. */
function mapAgrees(subtitle: ConferenceTranslationSubtitle): boolean {
  if (!subtitle.translations) return true;
  return (
    (subtitle.translations[subtitle.targetLanguage] ?? '') ===
    subtitle.translatedText
  );
}

/**
 * The variable-size part of a frame: subtitle texts, every translation in its
 * map, and the audio payload.
 */
function frameChars(input: {
  subtitle?: {
    sourceText: string;
    translatedText: string;
    translations?: Partial<Record<LanguageCode, string>>;
  };
  audio?: { payload: string };
}): number {
  const { subtitle } = input;
  const mapChars = Object.values(subtitle?.translations ?? {}).reduce(
    (sum, text) => sum + (text?.length ?? 0),
    0,
  );
  return (
    (subtitle
      ? subtitle.sourceText.length + subtitle.translatedText.length + mapChars
      : 0) + (input.audio?.payload.length ?? 0)
  );
}

/** Spend one frame and `chars` from the peer's buckets; refuse if either is short. */
function withinRelayLimits(peer: ParticipantSession, chars: number): boolean {
  const frames = (peer.limits.relayFrames ??= new TokenBucket(
    RELAY_FRAME_BURST,
    RELAY_FRAMES_PER_SECOND,
  ));
  const budget = (peer.limits.relayChars ??= new TokenBucket(
    RELAY_CHAR_BURST,
    RELAY_CHARS_PER_SECOND,
  ));
  // A frame refused by one bucket may already have spent from the other.
  // That only tightens a peer that is over its limit, and both refill in
  // seconds.
  return budget.take(chars) && frames.take();
}
