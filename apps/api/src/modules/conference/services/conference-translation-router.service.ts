import { Injectable } from '@nestjs/common';
import type {
  ConferenceTranslationAudio,
  ConferenceTranslationSubtitle,
} from '@chatofy/types';
import type { ConferenceRoom } from '../conference-room-registry.service';

type Deliver = (socketId: string, event: string, data: unknown) => void;

/**
 * Decides which room peers receive a speaker's translated output.
 *
 * Both rules skip the sender. Subtitles go to every peer who does NOT speak the
 * speaker's language — they already understand the original. Translated speech
 * goes only to peers who DO speak the language it was synthesized in: anyone
 * else would hear a second voice in a language they did not choose over the
 * speaker's own.
 */
@Injectable()
export class ConferenceTranslationRouter {
  routeSubtitle(
    room: ConferenceRoom,
    senderSocketId: string,
    subtitle: ConferenceTranslationSubtitle,
    deliver: Deliver,
  ): void {
    for (const [socketId, peer] of room.peers) {
      if (socketId === senderSocketId) continue;
      if (peer.sourceLanguage === subtitle.sourceLanguage) continue;
      deliver(socketId, 'conference.translation.subtitle', subtitle);
    }
  }

  routeAudio(
    room: ConferenceRoom,
    senderSocketId: string,
    audio: ConferenceTranslationAudio,
    deliver: Deliver,
  ): void {
    for (const [socketId, peer] of room.peers) {
      if (socketId === senderSocketId) continue;
      if (peer.sourceLanguage !== audio.lang) continue;
      deliver(socketId, 'conference.translation.audio', audio);
    }
  }
}
