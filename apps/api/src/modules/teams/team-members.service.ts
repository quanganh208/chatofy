import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  teamRoleSchema,
  type TeamMemberEntry,
  type TeamRole,
} from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { TeamScope } from '../../common/library-scope/library-scope';
import type { Env } from '../../config/env.schema';
import { TeamAccessService } from './team-access.service';
import { lockTeam } from './team-locks';

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

interface MemberUser {
  name: string | null;
  email: string;
  avatarKey: string | null;
}

/**
 * A team's member list, role changes and removals.
 *
 * Members are addressed by their `TeamMember` row id and no response ever
 * carries a user id, not even inside an avatar URL (avatar keys embed it), so
 * only the viewer's own row has one. A plain member sees teammates' name and
 * role but not their email; owners and admins see every email.
 */
@Injectable()
export class TeamMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TeamAccessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Read through the config service, as `AuthService` does, so an unset base yields no URL. */
  private get avatarBaseUrl(): string | undefined {
    return this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
  }

  async list(scope: TeamScope): Promise<TeamMemberEntry[]> {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: scope.teamId },
      orderBy: { joinedAt: 'asc' },
      select: { id: true, userId: true, role: true, joinedAt: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, email: true, avatarKey: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    // A member whose account is gone has nothing to show, so the row is skipped.
    return members.flatMap((member) => {
      const user = byId.get(member.userId);
      return user ? [this.toMemberEntry(member, user, scope)] : [];
    });
  }

  /** Owner only (resolved by the controller). The owner's own role never changes here. */
  async changeRole(
    scope: TeamScope,
    memberId: string,
    role: Exclude<TeamRole, 'owner'>,
  ): Promise<TeamMemberEntry> {
    return this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, scope.teamId);
      const target = await tx.teamMember.findFirst({
        where: { id: memberId, teamId: scope.teamId },
        select: { id: true, role: true },
      });
      if (target === null) throw new NotFoundException('Member not found.');
      if (target.role === 'owner') {
        throw new ConflictException("The owner's role cannot be changed.");
      }
      const updated = await tx.teamMember.update({
        where: { id: target.id },
        data: { role },
        select: { id: true, userId: true, role: true, joinedAt: true },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: updated.userId },
        select: { name: true, email: true, avatarKey: true },
      });
      return this.toMemberEntry(updated, user, scope);
    });
  }

  /**
   * Remove a member, or leave when the target is the caller.
   *
   * Membership is checked BEFORE the transaction, so a non-member is refused
   * with 404 without ever queueing on the team lock or holding a pooled
   * connection. Inside the transaction, after the lock, the caller's role is
   * read again on `tx`: a role change or removal that landed in between is
   * seen, and the transaction never needs a second connection while it holds
   * the lock (which, under a burst of calls, would starve the pool).
   */
  async remove(
    callerId: string,
    teamId: string,
    memberId: string,
  ): Promise<void> {
    await this.access.resolve(callerId, teamId);
    await this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const callerRow = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: callerId } },
        select: { role: true },
      });
      const callerRole = teamRoleSchema.safeParse(callerRow?.role);
      if (callerRow === null || !callerRole.success) {
        throw new NotFoundException('Team not found.');
      }
      const target = await tx.teamMember.findFirst({
        where: { id: memberId, teamId },
        select: { id: true, userId: true, role: true },
      });
      if (target === null) throw new NotFoundException('Member not found.');

      if (target.userId === callerId) {
        if (callerRole.data === 'owner') {
          throw new ConflictException(
            'The owner cannot leave. Delete the team instead.',
          );
        }
      } else if (
        callerRole.data === 'member' ||
        target.role === 'owner' ||
        (target.role === 'admin' && callerRole.data !== 'owner')
      ) {
        throw new ForbiddenException(
          'Your role in this team does not allow this.',
        );
      }
      await tx.teamMember.delete({ where: { id: target.id } });
    });
  }

  private toMemberEntry(
    member: MemberRow,
    user: MemberUser,
    scope: TeamScope,
  ): TeamMemberEntry {
    const isSelf = member.userId === scope.userId;
    const base = this.avatarBaseUrl;
    return {
      id: member.id,
      name: user.name ?? null,
      email: scope.role !== 'member' || isSelf ? user.email : null,
      // The viewer's own row only. An avatar key is `avatars/{userId}/...`, so a
      // teammate's URL would expose their user id, which no member may see.
      // Otherwise built exactly as `toUserContract` builds it: no key or no
      // base, no URL.
      avatarUrl:
        isSelf && user.avatarKey && base
          ? `${base.replace(/\/$/, '')}/${user.avatarKey}`
          : null,
      // A stored role this build cannot read is shown as the least privileged.
      role: teamRoleSchema.catch('member').parse(member.role),
      joinedAt: member.joinedAt.toISOString(),
      isSelf,
    };
  }
}
