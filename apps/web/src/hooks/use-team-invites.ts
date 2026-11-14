'use client';

import { useCallback } from 'react';
import type { CreateTeamInviteRequest, TeamInvite } from '@chatofy/types';
import { createTeamInvite, listTeamInvites, revokeTeamInvite } from '@/clients/teams-api-client';
import { useTeamList } from './use-team-list';

const fetchInvites = (teamId: string) => listTeamInvites(teamId).then((r) => r.invites);

/**
 * The team's open invites, for admins and the owner (`enabled` is false for a plain
 * member, who cannot list them). An invite is never mailed twice: to send a new link,
 * withdraw the invite and create another.
 */
export function useTeamInvites(teamId: string, enabled: boolean) {
  const { rows, status, mutate } = useTeamList<TeamInvite>(teamId, enabled, fetchInvites);

  const create = useCallback(
    (body: CreateTeamInviteRequest) => mutate(() => createTeamInvite(teamId, body)),
    [teamId, mutate],
  );
  const revoke = useCallback(
    (inviteId: string) => mutate(() => revokeTeamInvite(teamId, inviteId)),
    [teamId, mutate],
  );

  return { invites: rows, status, create, revoke };
}
