import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  teamRoleSchema,
  type TeamRole,
  type TeamSummary,
} from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mintTeamScope,
  type TeamScope,
} from '../../common/library-scope/library-scope';
import { TEAM_SUMMARY_SELECT, toTeamSummary } from './team-summary';

const RANK: Record<TeamRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * The one membership check, and the only caller of `mintTeamScope`.
 *
 * The role is read from `TeamMember` on every request, never from the JWT, so
 * a removal or a role change takes effect on the caller's very next request. A
 * non-member gets 404 rather than 403, so whether a team exists is not
 * revealed to someone outside it.
 */
@Injectable()
export class TeamAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's scope in `teamId`, or 404 for a non-member (and for a stored
   * role this build cannot read), or 403 for a member below `minRole`.
   */
  async resolve(
    userId: string,
    teamId: string,
    minRole: TeamRole = 'member',
  ): Promise<TeamScope> {
    const row = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { role: true },
    });
    const parsed = teamRoleSchema.safeParse(row?.role);
    if (row === null || !parsed.success) {
      throw new NotFoundException('Team not found.');
    }
    if (RANK[parsed.data] < RANK[minRole]) {
      throw new ForbiddenException(
        'Your role in this team does not allow this.',
      );
    }
    return mintTeamScope(userId, teamId, parsed.data);
  }

  /**
   * Every team the caller belongs to, oldest membership first.
   *
   * This is the ONE membership list: `GET /teams`, the translate picker's list
   * and invite accept all read it, so their team order never drifts. A row
   * whose stored role this build cannot read is skipped, as `resolve` would
   * refuse it.
   */
  async memberships(
    userId: string,
  ): Promise<{ scope: TeamScope; team: TeamSummary }[]> {
    const rows = await this.prisma.teamMember.findMany({
      where: { userId },
      orderBy: { joinedAt: 'asc' },
      select: {
        teamId: true,
        role: true,
        team: { select: TEAM_SUMMARY_SELECT },
      },
    });
    return rows.flatMap((row) => {
      const parsed = teamRoleSchema.safeParse(row.role);
      if (!parsed.success) return [];
      return [
        {
          scope: mintTeamScope(userId, row.teamId, parsed.data),
          team: toTeamSummary(row.team, parsed.data),
        },
      ];
    });
  }
}
