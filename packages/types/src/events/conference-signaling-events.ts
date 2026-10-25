// Conference signaling events — what a client sends to /ws/conference to join
// a room and talk to the SFU. The gateway `safeParse`s every one of these and
// replies `{ error: 'invalid_payload' }` to anything that does not match.
import { z } from 'zod';

import { languageCodeSchema } from '../domain/languages.js';

/**
 * A room id is the cuid `POST /conference` minted. The gateway never creates a
 * room, so an id that is not a cuid can never name one; refusing it here keeps
 * arbitrary client strings out of the registry and the database.
 */
export const conferenceRoomIdSchema = z.cuid();

export const MAX_CONFERENCE_DISPLAY_NAME_CHARS = 64;
export const MAX_CONFERENCE_CHAT_TEXT_CHARS = 2000;

/** conference.join */
export const ConferenceJoinSchema = z.object({
  roomId: conferenceRoomIdSchema,
  displayName: z.string().trim().min(1).max(MAX_CONFERENCE_DISPLAY_NAME_CHARS),
  sourceLanguage: languageCodeSchema,
});
export type ConferenceJoin = z.infer<typeof ConferenceJoinSchema>;

/** conference.chat */
export const ConferenceChatSendSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CONFERENCE_CHAT_TEXT_CHARS),
});
export type ConferenceChatSend = z.infer<typeof ConferenceChatSendSchema>;

/**
 * Stable error codes the gateway replies with. Clients map these to copy; the
 * gateway never forwards an internal error message.
 */
export const CONFERENCE_ERROR_CODES = [
  'invalid_payload',
  'room_not_found',
  'room_ended',
  'not_in_room',
  'peer_not_found',
  'transport_exists',
  'limit_reached',
  'text_too_long',
  'internal_error',
] as const;
export type ConferenceErrorCode = (typeof CONFERENCE_ERROR_CODES)[number];

// ── SFU signaling ────────────────────────────────────────────────────────────
//
// The mediasoup-shaped fields (`dtlsParameters`, `rtpParameters`,
// `rtpCapabilities`) are bounded here and checked in depth by mediasoup itself,
// which throws on anything it cannot use. What these schemas guarantee is the
// shape the gateway reads and an upper bound on what it hands to the SFU.

/** A mediasoup object id (transport, producer, consumer). */
const sfuIdSchema = z.string().min(1).max(64);

/** An open JSON object whose own nested structure mediasoup validates. */
const sfuObjectSchema = z.looseObject({});

/** conference.transport.create */
export const ConferenceTransportCreateSchema = z.object({
  direction: z.enum(['send', 'recv']),
});
export type ConferenceTransportCreate = z.infer<typeof ConferenceTransportCreateSchema>;

/** conference.transport.connect */
export const ConferenceTransportConnectSchema = z.object({
  transportId: sfuIdSchema,
  dtlsParameters: z.looseObject({
    role: z.enum(['auto', 'client', 'server']).optional(),
    fingerprints: z
      .array(z.object({ algorithm: z.string().max(32), value: z.string().max(256) }))
      .min(1)
      .max(8),
  }),
});
export type ConferenceTransportConnect = z.infer<typeof ConferenceTransportConnectSchema>;

/**
 * Producer `appData`, which the gateway relays to every other peer in
 * `conference.new.producer`. Kept to a handful of flat primitive values so a
 * client cannot use it to fan arbitrary data out to the room.
 */
const producerAppDataSchema = z
  .record(z.string().max(32), z.union([z.string().max(64), z.number(), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 8, 'at most 8 appData keys');

/** conference.produce */
export const ConferenceProduceSchema = z.object({
  kind: z.enum(['audio', 'video']),
  rtpParameters: z.looseObject({
    codecs: z.array(sfuObjectSchema).min(1).max(16),
    encodings: z.array(sfuObjectSchema).max(8).optional(),
    headerExtensions: z.array(sfuObjectSchema).max(32).optional(),
  }),
  appData: producerAppDataSchema.optional(),
});
export type ConferenceProduce = z.infer<typeof ConferenceProduceSchema>;

/** conference.consume */
export const ConferenceConsumeSchema = z.object({
  producerId: sfuIdSchema,
  rtpCapabilities: z.looseObject({
    codecs: z.array(sfuObjectSchema).max(64).optional(),
    headerExtensions: z.array(sfuObjectSchema).max(64).optional(),
  }),
});
export type ConferenceConsume = z.infer<typeof ConferenceConsumeSchema>;

/** conference.consumer.resume */
export const ConferenceConsumerResumeSchema = z.object({
  consumerId: sfuIdSchema,
});
export type ConferenceConsumerResume = z.infer<typeof ConferenceConsumerResumeSchema>;

/** conference.participant.mute */
export const ConferenceParticipantMuteSchema = z.object({ muted: z.boolean() });
export type ConferenceParticipantMute = z.infer<typeof ConferenceParticipantMuteSchema>;

/** conference.participant.video */
export const ConferenceParticipantVideoSchema = z.object({ videoEnabled: z.boolean() });
export type ConferenceParticipantVideo = z.infer<typeof ConferenceParticipantVideoSchema>;

/**
 * conference.ended — sent by the server to every peer when the owner ends the
 * room, right before it closes their sockets with code 4001.
 */
export const ConferenceEndedSchema = z.object({ reason: z.literal('ended_by_owner') });
export type ConferenceEnded = z.infer<typeof ConferenceEndedSchema>;

/** Close code for a socket whose room the owner ended. Clients must not reconnect. */
export const CONFERENCE_CLOSE_ENDED = 4001;
/** Close code for a socket replaced by the same user's newer join. Clients must not reconnect. */
export const CONFERENCE_CLOSE_REPLACED = 4000;
