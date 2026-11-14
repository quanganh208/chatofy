import { ConflictException, Injectable } from '@nestjs/common';
import { TEAM_LIMITS, type TeamSummary } from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { TeamScope } from '../../common/library-scope/library-scope';
import { TeamAccessService } from './team-access.service';
import { lockTeam, lockUser } from './team-locks';
import { TEAM_SUMMARY_SELECT, toTeamSummary } from './team-summary';

/**
 * Team lifecycle: create, list, rename, delete.
 *
 * Rename and delete take a `TeamScope` the controller resolved with the owner
 * role, so a caller below owner never reaches them.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TeamAccessService,
  ) {}

  /**
   * Create a team owned by the caller.
   *
   * The membership cap is a COUNT, so it is read under the caller's user lock
   * in the same transaction as the insert: two creates fired together one
   * short of the cap cannot both see room.
   */
  async create(userId: string, name: string): Promise<TeamSummary> {
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const held = await tx.teamMember.count({ where: { userId } });
      if (held >= TEAM_LIMITS.MAX_TEAMS_PER_USER) {
        throw new ConflictException(
          `You can be in at most ${TEAM_LIMITS.MAX_TEAMS_PER_USER} teams.`,
        );
      }
      const team = await tx.team.create({
        data: { name, members: { create: { userId, role: 'owner' } } },
        select: TEAM_SUMMARY_SELECT,
      });
      return toTeamSummary(team, 'owner');
    });
  }

  async list(userId: string): Promise<TeamSummary[]> {
    return (await this.access.memberships(userId)).map((m) => m.team);
  }

  async rename(scope: TeamScope, name: string): Promise<TeamSummary> {
    const team = await this.prisma.team.update({
      where: { id: scope.teamId },
      data: { name },
      select: TEAM_SUMMARY_SELECT,
    });
    return toTeamSummary(team, scope.role);
  }

  /** Deletes the team; members, invites, glossaries and contexts cascade with it. */
  async remove(scope: TeamScope): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, scope.teamId);
      await tx.team.delete({ where: { id: scope.teamId } });
    });
  }
}
