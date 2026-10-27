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
 *
 * A subtitle translated into several languages carries them all in its
 * `translations` map. Each listener is sent the frame narrowed to their own
 * language — `targetLanguage` set to it, `translatedText` its entry — and the
 * map itself is never forwarded, so a listener parses exactly the frame it
 * always did. A listener whose language has no entry yet gets the source text,
 * which shows them someone is speaking until the translation lands. A frame
 * without a map, from a speaker translating into one language, is delivered
 * unchanged.
 */
@Injectable()
export class ConferenceTranslationRouter {
  routeSubtitle(
    room: ConferenceRoom,
    senderSocketId: string,
    subtitle: ConferenceTranslationSubtitle,
    deliver: Deliver,
  ): void {
    const { translations, ...single } = subtitle;
    for (const [socketId, peer] of room.peers) {
      if (socketId === senderSocketId) continue;
      if (peer.sourceLanguage === subtitle.sourceLanguage) continue;
      deliver(
        socketId,
        'conference.translation.subtitle',
        translations
          ? {
              ...single,
              targetLanguage: peer.sourceLanguage,
              translatedText:
                translations[peer.sourceLanguage] ?? subtitle.sourceText,
            }
          : subtitle,
      );
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
