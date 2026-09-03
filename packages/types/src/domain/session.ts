// Speaker roles for a live conversation — schema-first (zod source, type inferred).
//
// This file used to hold a `ConversationSession` contract and a session-status
// enum for an API surface that never shipped: nothing outside the barrel ever
// imported them, and the sessions module they belonged to was deleted with them.
// A conversation is now a STORED artifact (`domain/conversation.ts`), keyed by an
// id the browser mints, and its lifecycle is not a server-side state machine.
//
// `speakerRoleSchema` stayed because it is live: `domain/transcript.ts` imports
// it, which reaches `events/ws-events.ts` and the socket contracts. It is
// deliberately NOT moved into that file in the same change — the deletion above
// is what this file is about, and shifting a live schema between modules at the
// same time would put unrelated import churn in the same diff. The filename is
// now slightly wider than its contents; that is the cheaper of the two costs.
import { z } from 'zod';

export const speakerRoleSchema = z.enum(['speaker_a', 'speaker_b']);
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;
