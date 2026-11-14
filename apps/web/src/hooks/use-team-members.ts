'use client';

import { useCallback } from 'react';
import type { TeamMemberEntry } from '@chatofy/types';
import {
  changeTeamMemberRole,
  listTeamMembers,
  removeTeamMember,
} from '@/clients/teams-api-client';
import { useTeamList } from './use-team-list';

const fetchMembers = (teamId: string) => listTeamMembers(teamId).then((r) => r.members);

/** The team's members, reloaded after each change. Writes reject so a form can say why. */
export function useTeamMembers(teamId: string) {
  const { rows, status, retry, mutate } = useTeamList<TeamMemberEntry>(teamId, true, fetchMembers);

  const changeRole = useCallback(
    (memberId: string, role: 'admin' | 'member') =>
      mutate(() => changeTeamMemberRole(teamId, memberId, { role })),
    [teamId, mutate],
  );
  const remove = useCallback(
    (memberId: string) => mutate(() => removeTeamMember(teamId, memberId)),
    [teamId, mutate],
  );

  return { members: rows, status, changeRole, remove, retry };
}
