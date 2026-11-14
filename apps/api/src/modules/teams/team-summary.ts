import type { TeamRole, TeamSummary } from '@chatofy/types';

/** The columns every team summary is read with. */
export const TEAM_SUMMARY_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  _count: { select: { members: true } },
} as const;

interface TeamSummaryRow {
  id: string;
  name: string;
  createdAt: Date;
  _count: { members: number };
}

/** The only `TeamSummary` mapper: the caller's role is supplied, never read here. */
export function toTeamSummary(
  team: TeamSummaryRow,
  role: TeamRole,
): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    role,
    memberCount: team._count.members,
    createdAt: team.createdAt.toISOString(),
  };
}
