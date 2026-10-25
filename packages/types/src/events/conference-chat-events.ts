// Conference chat events — in-meeting text chat, translated per recipient on
// the /ws/conference gateway. Each sent message is stored once, in the
// sender's language, as a ConferenceMessage row.
import { z } from 'zod';

import { languageCodeSchema as langCodeSchema } from '../domain/languages.js';

/**
 * conference.chat.message
 *
 * Delivered by the gateway to each participant (and echoed to the sender). The
 * gateway translates one sent message into every distinct recipient language;
 * `text` is the message as delivered to THIS recipient and `lang` is the
 * language of that text, so a client can label / lay out by language.
 */
export const ConferenceChatMessageSchema = z.object({
  /** Shared across all recipient copies of one sent message. */
  id: z.string(),
  /** socketId of the sender. */
  socketId: z.string(),
  /** Display name of the sender. */
  displayName: z.string(),
  /** Message text as delivered to this recipient. */
  text: z.string(),
  /** ISO-639-1 language of `text` as delivered to this recipient. */
  lang: langCodeSchema,
  /** Epoch milliseconds the gateway stamped the message. */
  sentAt: z.number(),
});
export type ConferenceChatMessage = z.infer<typeof ConferenceChatMessageSchema>;
