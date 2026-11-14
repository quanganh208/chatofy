import type { TeamMemberEntry, TeamRole, TeamSummary } from '@chatofy/types';

/** Settings › Team fixtures: one team in a given role, and members keyed by a letter. */
export const team = (role: TeamRole): TeamSummary => ({
  id: 'c' + 'a'.repeat(24),
  name: 'Cardiology unit',
  role,
  memberCount: 3,
  createdAt: '2026-11-14T00:00:00.000Z',
});

export const member = (
  id: string,
  role: TeamRole,
  isSelf: boolean,
  email: string | null,
): TeamMemberEntry => ({
  id: 'c' + id.repeat(24),
  name: `Name ${id}`,
  email,
  avatarUrl: null,
  role,
  joinedAt: '2026-11-14T00:00:00.000Z',
  isSelf,
});
