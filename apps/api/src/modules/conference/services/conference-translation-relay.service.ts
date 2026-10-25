import { Injectable } from '@nestjs/common';
import {
  ConferenceTranslationBroadcastSchema,
  normalizeForSearch,
  type ConferenceTranslationAudio,
  type ConferenceTranslationSubtitle,
} from '@chatofy/types';
import { ConferencePeerLifecycle } from '../conference-peer-lifecycle.service';
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
