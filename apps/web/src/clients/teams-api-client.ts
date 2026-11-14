/**
 * Team routes: teams, members, invites and the invite page's preview and accept.
 *
 * Every call goes through {@link authedFetch}, so a team request renews an expired
 * session the same way every other signed-in request does. A refusal reaches the
 * caller as an `ApiClientError`; screens map it by HTTP status, never by message
 * text, because the message is English-only server copy.
 *
 * An invite is never mailed twice: an admin withdraws an invite and creates a new one, so every
 * mail the server sends answers a fresh, separately rate-limited request.
 */
import { z } from 'zod';
import { ApiClientError } from '@chatofy/api-client';
import {
  acceptInviteResponseSchema,
  inviteRefusalStatusSchema,
  invitePreviewResponseSchema,
  teamInviteListResponseSchema,
  teamInviteResponseSchema,
  teamListResponseSchema,
  teamMemberListResponseSchema,
  teamMemberResponseSchema,
  teamResponseSchema,
  type ChangeMemberRoleRequest,
  type CreateTeamInviteRequest,
  type CreateTeamRequest,
  type InviteRefusalStatus,
  type RenameTeamRequest,
} from '@chatofy/types';
import { authedFetch } from './api-client';

const teamPath = (teamId: string) => `/teams/${encodeURIComponent(teamId)}`;

// ─── Teams ───────────────────────────────────────────────────────────────────

/** The caller's teams, in the order they joined them. */
export function listTeams() {
  return authedFetch('/teams', teamListResponseSchema);
}

/** Create a team with the caller as owner. 409 at the per-user team cap. */
export function createTeam(body: CreateTeamRequest) {
  return authedFetch('/teams', teamResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Owner only. */
export function renameTeam(teamId: string, body: RenameTeamRequest) {
  return authedFetch(teamPath(teamId), teamResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Owner only. Deletes the team's glossaries and AI Contexts for everyone (204). */
export function deleteTeam(teamId: string) {
  return authedFetch(teamPath(teamId), z.undefined(), { method: 'DELETE' });
}

// ─── Members ─────────────────────────────────────────────────────────────────

export function listTeamMembers(teamId: string) {
  return authedFetch(`${teamPath(teamId)}/members`, teamMemberListResponseSchema);
}

/** Owner only; the owner's own row cannot change role. */
export function changeTeamMemberRole(
  teamId: string,
  memberId: string,
  body: ChangeMemberRoleRequest,
) {
  return authedFetch(
    `${teamPath(teamId)}/members/${encodeURIComponent(memberId)}`,
    teamMemberResponseSchema,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

/** Remove a member, or leave when `memberId` is the caller's own row (204). */
export function removeTeamMember(teamId: string, memberId: string) {
  return authedFetch(`${teamPath(teamId)}/members/${encodeURIComponent(memberId)}`, z.undefined(), {
    method: 'DELETE',
  });
}

// ─── Invites ─────────────────────────────────────────────────────────────────

/** Admins and the owner only: the team's open invites. */
export function listTeamInvites(teamId: string) {
  return authedFetch(`${teamPath(teamId)}/invites`, teamInviteListResponseSchema);
}

/** 409 when refused (member, pending, cooldown, seats), 403 for a role, 429 when throttled. */
export function createTeamInvite(teamId: string, body: CreateTeamInviteRequest) {
  return authedFetch(`${teamPath(teamId)}/invites`, teamInviteResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Withdraw an invite. Idempotent (204). */
export function revokeTeamInvite(teamId: string, inviteId: string) {
  return authedFetch(`${teamPath(teamId)}/invites/${encodeURIComponent(inviteId)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/** What the invite holds and whether it can be accepted. Spends nothing. */
export function previewTeamInvite(token: string) {
  return authedFetch('/team-invites/preview', invitePreviewResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/** Join the team. The token travels in the body, never in a URL. */
export function acceptTeamInvite(token: string) {
  return authedFetch('/team-invites/accept', acceptInviteResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * The status an accept refusal carries: a 409 `INVITE_NOT_PENDING` holds it in
 * `details[0].message`. Anything else, or a value outside the enum, is null.
 */
export function inviteRefusalStatus(err: unknown): InviteRefusalStatus | null {
  if (!(err instanceof ApiClientError)) return null;
  if (err.status !== 409 || err.error.code !== 'INVITE_NOT_PENDING') return null;
  const parsed = inviteRefusalStatusSchema.safeParse(err.error.details?.[0]?.message);
  return parsed.success ? parsed.data : null;
}
