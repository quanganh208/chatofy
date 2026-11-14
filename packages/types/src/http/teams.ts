import { z } from 'zod';

/**
 * A member's role in a team. Stored as text in `TeamMember.role` and narrowed
 * here, at the boundary, so a new role is a contract change rather than a
 * column migration.
 */
export const teamRoleSchema = z.enum(['owner', 'admin', 'member']);
export type TeamRole = z.infer<typeof teamRoleSchema>;

/**
 * Team ceilings.
 *
 * - Memberships per user count both owned and joined teams.
 * - Seats per team count members plus LIVE invites (unexpired, unaccepted,
 *   unrevoked) when an invite is created; accepting an invite re-checks
 *   members alone.
 */
export const TEAM_LIMITS = {
  MAX_TEAMS_PER_USER: 5,
  MAX_SEATS_PER_TEAM: 20,
  MAX_NAME_CHARS: 60,
  MAX_CONTEXTS_PER_TEAM: 20,
  MAX_GLOSSARIES_PER_TEAM: 20,
  INVITE_TTL_DAYS: 7,
  MAX_INVITES_PER_INVITER_PER_DAY: 20,
} as const;

/** A team's server id. Teams have no client-minted id. */
export const teamIdSchema = z.cuid();
export const teamNameSchema = z.string().trim().min(1).max(TEAM_LIMITS.MAX_NAME_CHARS);

export const createTeamRequestSchema = z.object({ name: teamNameSchema });
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const renameTeamRequestSchema = z.object({ name: teamNameSchema });
export type RenameTeamRequest = z.infer<typeof renameTeamRequestSchema>;

/** One team as the caller sees it, with the caller's own role. */
export const teamSummarySchema = z.object({
  id: teamIdSchema,
  name: z.string(),
  role: teamRoleSchema,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamListResponseSchema = z.object({
  teams: z.array(teamSummarySchema),
});
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;

export const teamResponseSchema = z.object({ team: teamSummarySchema });
export type TeamResponse = z.infer<typeof teamResponseSchema>;

/**
 * One member as another member sees them.
 *
 * `id` is the TeamMember row id. `email` is null unless the viewer is an owner
 * or admin, or the row is the viewer's own. No user id is ever exposed.
 */
export const teamMemberSchema = z.object({
  id: z.cuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: teamRoleSchema,
  joinedAt: z.string(),
  isSelf: z.boolean(),
});
export type TeamMemberEntry = z.infer<typeof teamMemberSchema>;

export const teamMemberListResponseSchema = z.object({
  members: z.array(teamMemberSchema),
});
export type TeamMemberListResponse = z.infer<typeof teamMemberListResponseSchema>;

export const teamMemberResponseSchema = z.object({ member: teamMemberSchema });
export type TeamMemberResponse = z.infer<typeof teamMemberResponseSchema>;

/** The owner role is never assigned through this route. */
export const changeMemberRoleRequestSchema = z.object({
  role: z.enum(['admin', 'member']),
});
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleRequestSchema>;
