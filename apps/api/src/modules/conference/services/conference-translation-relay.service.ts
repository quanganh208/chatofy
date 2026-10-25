import { Injectable } from '@nestjs/common';
import {
  ConferenceTranslationBroadcastSchema,
  normalizeForSearch,
  type ConferenceTranslationAudio,
  type ConferenceTranslationSubtitle,
} from '@chatofy/types';
import { ConferencePeerLifecycle } from '../conference-peer-lifecycle.service';
import { TokenBucket } from '../conference-token-bucket';
import type { ParticipantSession } from '../conference-room-registry.service';
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
 * Sized from what a live session really sends: translated speech arrives in
 * 200 ms frames (24 kHz pcm16 ≈ 12.8 k base64 chars each, 64 k/s at real time,
 * delivered in bursts faster than that) interleaved with cumulative subtitle
 * frames on each transcript delta (up to 2 × 4000 chars). The character budget
 * is the real bandwidth bound and sits several times above that; the frame
 * count is set loosely (a burst of speech frames plus a delta per token can
 * pass 40/s for a moment), so a real speaker never meets either, while a peer
 * looping maximum-size frames meets the character budget within seconds.
 */
export const RELAY_FRAME_BURST = 300;
const RELAY_FRAMES_PER_SECOND = 100;
export const RELAY_CHAR_BURST = 2 * 1024 * 1024;
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
      if (subtitle.isFinal) this.persistFinal(peer, room.id, subtitle);
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
   * in the speaker's language and the translation under its language. Frames
   * before the final are provisional and are never stored; a final repeated
   * for the same turn is dropped.
   */
  private persistFinal(
    peer: ParticipantSession,
    conferenceId: string,
    subtitle: ConferenceTranslationSubtitle,
  ): void {
    if (peer.persistedTurnIds.has(subtitle.turnId)) return;
    rememberTurn(peer.persistedTurnIds, subtitle.turnId);

    const sourceText = subtitle.sourceText.trim();
    const translatedText = subtitle.translatedText.trim();
    if (!sourceText && !translatedText) return;

    void this.persistence.recordTurn(peer.participantId, conferenceId, {
      sourceLanguage: subtitle.sourceLanguage,
      sourceText,
      searchText: normalizeForSearch(`${sourceText} ${translatedText}`),
      translations: translatedText
        ? { [subtitle.targetLanguage]: translatedText }
        : {},
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

/** The variable-size part of a frame: subtitle texts plus the audio payload. */
function frameChars(input: {
  subtitle?: { sourceText: string; translatedText: string };
  audio?: { payload: string };
}): number {
  return (
    (input.subtitle
      ? input.subtitle.sourceText.length + input.subtitle.translatedText.length
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
