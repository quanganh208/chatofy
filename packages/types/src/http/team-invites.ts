import { z } from 'zod';
import { teamResponseSchema } from './teams.js';

/**
 * Team invite contracts.
 *
 * An invite is a single-use link mailed to one address. Only the sha256 of its
 * token is stored, so nothing here ever carries the token back out, and there
 * is no resend: to repeat an invite, withdraw it and invite again.
 */

/** The role an invite grants. Ownership is never granted by invite. */
export const inviteRoleSchema = z.enum(['admin', 'member']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

/** POST /teams/:teamId/invites body. */
export const createTeamInviteRequestSchema = z.object({
  email: z.email().max(254),
  role: inviteRoleSchema,
});
export type CreateTeamInviteRequest = z.infer<typeof createTeamInviteRequestSchema>;

/** One open invite, as an admin lists it. */
export const teamInviteSchema = z.object({
  id: z.cuid(),
  email: z.string(),
  role: inviteRoleSchema,
  status: z.enum(['pending', 'expired']),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type TeamInvite = z.infer<typeof teamInviteSchema>;

export const teamInviteResponseSchema = z.object({ invite: teamInviteSchema });
export type TeamInviteResponse = z.infer<typeof teamInviteResponseSchema>;

export const teamInviteListResponseSchema = z.object({
  invites: z.array(teamInviteSchema),
});
export type TeamInviteListResponse = z.infer<typeof teamInviteListResponseSchema>;

/** 32 random bytes, base64url: 43 characters, never in a URL the API reads. */
export const teamInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** POST /team-invites/preview and /team-invites/accept body. */
export const inviteTokenRequestSchema = z.object({
  token: teamInviteTokenSchema,
});
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>;

/** One enum for preview and for accept's 409 `details`. */
export const invitePreviewStatusSchema = z.enum([
  'pending',
  'accepted',
  'revoked',
  'expired',
  'wrong-account',
  'already-member',
  'team-cap',
  'team-full',
]);
export type InvitePreviewStatus = z.infer<typeof invitePreviewStatusSchema>;

/** The statuses accept refuses with 409 INVITE_NOT_PENDING. */
export const inviteRefusalStatusSchema = invitePreviewStatusSchema.extract([
  'accepted',
  'revoked',
  'expired',
  'team-cap',
  'team-full',
]);
export type InviteRefusalStatus = z.infer<typeof inviteRefusalStatusSchema>;

/**
 * What the invitee sees before accepting. `teamName` is chosen by whoever made
 * the team, so a client renders it as plain text next to `inviterEmail`.
 */
export const invitePreviewResponseSchema = z.object({
  status: invitePreviewStatusSchema,
  teamName: z.string().nullable(),
  role: inviteRoleSchema.nullable(),
  inviterEmail: z.string().nullable(),
});
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>;

/** Accept answers with the team the caller just joined. */
export const acceptInviteResponseSchema = teamResponseSchema;
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
