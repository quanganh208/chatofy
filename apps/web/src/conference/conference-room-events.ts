/**
 * Server-initiated room events, validated at the socket boundary.
 *
 * Request replies (`conference.join`, `conference.media.subscribe`, …) travel
 * on the same socket and are not room events; `parseRoomEvent` returns null for
 * them and for anything that fails its schema.
 */
import { z } from 'zod';
import { languageCodeSchema, type LanguageCode } from '@chatofy/types';
import {
  ConferenceChatMessageSchema,
  ConferenceMediaPublishedSchema,
  ConferenceTranslationAudioSchema,
  ConferenceTranslationSubtitleSchema,
  type ConferenceChatMessage,
  type ConferenceTranslationAudio,
  type ConferenceTranslationSubtitle,
} from '@chatofy/types/events';
import type { SignalMessage } from './conference-signaling';
import type { ConferenceChatRefusal } from './conference-types';

const socketIdSchema = z.string().min(1).max(64);

/**
 * A peer's spoken language, when the gateway names one this build knows.
 *
 * Optional, and an unknown code is dropped rather than refusing the frame: a
 * gateway from before the field, or one that speaks a language added later,
 * must still have its joins read. The speaker leg treats that peer's language
 * as unknown.
 */
export const peerLanguageSchema = languageCodeSchema.optional().catch(undefined);

const peerJoinedSchema = z.object({
  socketId: socketIdSchema,
  displayName: z.string(),
  sourceLanguage: peerLanguageSchema,
});
const peerLeftSchema = z.object({ socketId: socketIdSchema });
const participantStateSchema = z.object({
  socketId: socketIdSchema,
  muted: z.boolean().optional(),
  videoEnabled: z.boolean().optional(),
});
// The gateway answers a refused `conference.chat` on the same event name; a
// sent message that is accepted comes back as `conference.chat.message`.
const chatRefusalSchema = z.object({ error: z.string() });
// A refused `conference.translation.broadcast` is answered on its own name.
const broadcastRefusalSchema = z.object({ error: z.string() });
const endedSchema = z.object({ reason: z.string().optional() }).optional();

export type RoomEvent =
  | { type: 'media-published'; socketId: string }
  | { type: 'peer-joined'; socketId: string; displayName: string; sourceLanguage?: LanguageCode }
  | { type: 'peer-left'; socketId: string }
  | { type: 'participant-state'; socketId: string; muted?: boolean; videoEnabled?: boolean }
  | { type: 'subtitle'; subtitle: ConferenceTranslationSubtitle }
  | { type: 'audio'; audio: ConferenceTranslationAudio & { speakerSocketId: string } }
  | { type: 'chat'; message: ConferenceChatMessage }
  | { type: 'chat-refused'; refusal: ConferenceChatRefusal }
  | { type: 'broadcast-refused'; code: string }
  | { type: 'ended' };

export function parseRoomEvent(signal: SignalMessage): RoomEvent | null {
  const { data } = signal;
  switch (signal.event) {
    case 'conference.media.published': {
      const parsed = ConferenceMediaPublishedSchema.safeParse(data);
      return parsed.success ? { type: 'media-published', socketId: parsed.data.socketId } : null;
    }
    case 'conference.peer.joined': {
      const parsed = peerJoinedSchema.safeParse(data);
      if (!parsed.success) return null;
      const { socketId, displayName, sourceLanguage } = parsed.data;
      return {
        type: 'peer-joined',
        socketId,
        displayName,
        ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
      };
    }
    case 'conference.peer.left': {
      const parsed = peerLeftSchema.safeParse(data);
      return parsed.success ? { type: 'peer-left', ...parsed.data } : null;
    }
    case 'conference.participant.state': {
      const parsed = participantStateSchema.safeParse(data);
      return parsed.success ? { type: 'participant-state', ...parsed.data } : null;
    }
    case 'conference.translation.subtitle': {
      const parsed = ConferenceTranslationSubtitleSchema.safeParse(data);
      return parsed.success ? { type: 'subtitle', subtitle: parsed.data } : null;
    }
    case 'conference.translation.audio': {
      const parsed = ConferenceTranslationAudioSchema.safeParse(data);
      // The gateway stamps the sender; a frame without one cannot be ordered.
      if (!parsed.success || !parsed.data.speakerSocketId) return null;
      return {
        type: 'audio',
        audio: { ...parsed.data, speakerSocketId: parsed.data.speakerSocketId },
      };
    }
    case 'conference.chat.message': {
      const parsed = ConferenceChatMessageSchema.safeParse(data);
      return parsed.success ? { type: 'chat', message: parsed.data } : null;
    }
    case 'conference.chat': {
      const parsed = chatRefusalSchema.safeParse(data);
      if (!parsed.success) return null;
      return {
        type: 'chat-refused',
        refusal: parsed.data.error === 'limit_reached' ? 'rate-limited' : 'not-sent',
      };
    }
    case 'conference.translation.broadcast': {
      const parsed = broadcastRefusalSchema.safeParse(data);
      return parsed.success ? { type: 'broadcast-refused', code: parsed.data.error } : null;
    }
    case 'conference.ended':
      return endedSchema.safeParse(data).success ? { type: 'ended' } : null;
    default:
      return null;
  }
}
