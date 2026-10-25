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
  'limit_reached',
  'text_too_long',
  'sfu_unavailable',
  'internal_error',
] as const;
export type ConferenceErrorCode = (typeof CONFERENCE_ERROR_CODES)[number];

// ── SFU signaling (Cloudflare Realtime) ─────────────────────────────────────
//
// Media goes from each client straight to Cloudflare Realtime SFU; the API
// holds the app secret and drives the SFU over HTTPS on the client's behalf.
// A client owns two RTCPeerConnections: one that publishes its own tracks and
// one that receives everyone else's. SDP is opaque here and bounded only by
// size; Cloudflare rejects anything it cannot negotiate.

/** Upper bound on one SDP blob a client may send or receive. */
export const MAX_CONFERENCE_SDP_CHARS = 64_000;

const sdpSchema = z.string().min(1).max(MAX_CONFERENCE_SDP_CHARS);
/** A transceiver `mid`, which belongs to the connection that negotiated it. */
const midSchema = z.string().min(1).max(16);
const socketIdSchema = z.string().min(1).max(64);
const mediaKindSchema = z.enum(['audio', 'video']);

/**
 * conference.media.publish — client → server. The offer from the publishing
 * connection and the `mid` of each sendonly transceiver, at most one per kind.
 * Replies `{ sdp }` with the SFU's answer, or `{ error }`.
 */
export const ConferenceMediaPublishSchema = z.object({
  sdp: sdpSchema,
  tracks: z
    .array(z.object({ mid: midSchema, kind: mediaKindSchema }))
    .min(1)
    .max(2)
    .refine(
      (tracks) => new Set(tracks.map((t) => t.kind)).size === tracks.length,
      'one track per kind',
    ),
});
export type ConferenceMediaPublish = z.infer<typeof ConferenceMediaPublishSchema>;

/**
 * conference.media.subscribe — client → server. "Bring my receiving
 * connection up to date with the room": the server works out which published
 * tracks this client does not hold yet, so the request carries nothing.
 * Replies with {@link ConferenceMediaSubscribeReplySchema}, or `{ error }`.
 */
export const ConferenceMediaSubscribeSchema = z.object({});
export type ConferenceMediaSubscribe = z.infer<typeof ConferenceMediaSubscribeSchema>;

/**
 * Reply to conference.media.subscribe. `sdp` is the SFU's offer for the
 * receiving connection, or `null` when there was nothing new to pull. `mids`
 * says which peer and kind each new receiving transceiver carries.
 */
export const ConferenceMediaSubscribeReplySchema = z.object({
  sdp: sdpSchema.nullable(),
  mids: z.array(z.object({ mid: midSchema, socketId: socketIdSchema, kind: mediaKindSchema })),
  /**
   * The server skipped something retryable; subscribe again after this delay.
   * Absent when the receiving connection holds everything published so far.
   */
  retryAfterMs: z.number().int().min(100).max(10_000).optional(),
});
export type ConferenceMediaSubscribeReply = z.infer<typeof ConferenceMediaSubscribeReplySchema>;

/**
 * conference.media.renegotiate — client → server. The receiving connection's
 * answer to the last subscribe offer. Replies `{ ok: true }`, or `{ error }`.
 */
export const ConferenceMediaRenegotiateSchema = z.object({ sdp: sdpSchema });
export type ConferenceMediaRenegotiate = z.infer<typeof ConferenceMediaRenegotiateSchema>;

/**
 * conference.media.published — server → other peers, once a peer's tracks are
 * live on the SFU. Receivers answer with conference.media.subscribe.
 */
export const ConferenceMediaPublishedSchema = z.object({ socketId: socketIdSchema });
export type ConferenceMediaPublished = z.infer<typeof ConferenceMediaPublishedSchema>;

/** One ICE server in the join reply, in RTCIceServer shape. */
export const ConferenceIceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type ConferenceIceServer = z.infer<typeof ConferenceIceServerSchema>;

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
