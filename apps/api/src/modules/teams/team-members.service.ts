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
 * carries a user id. A plain member sees teammates' name, avatar and role but
 * not their email; owners and admins see every email.
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
   * The caller's role is read by `TeamAccessService.resolve` on the shared
   * client rather than `tx`. It is a read-only check taken after the team lock,
   * and the millisecond gap before the delete is accepted: every role change
   * and removal also takes the team lock, so none can land inside it.
   */
  async remove(
    callerId: string,
    teamId: string,
    memberId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const caller = await this.access.resolve(callerId, teamId);
      const target = await tx.teamMember.findFirst({
        where: { id: memberId, teamId },
        select: { id: true, userId: true, role: true },
      });
      if (target === null) throw new NotFoundException('Member not found.');

      if (target.userId === callerId) {
        if (caller.role === 'owner') {
          throw new ConflictException(
            'The owner cannot leave. Delete the team instead.',
          );
        }
      } else if (
        caller.role === 'member' ||
        target.role === 'owner' ||
        (target.role === 'admin' && caller.role !== 'owner')
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
      // Built exactly as `toUserContract` builds it: no key or no base, no URL.
      avatarUrl:
        user.avatarKey && base
          ? `${base.replace(/\/$/, '')}/${user.avatarKey}`
          : null,
      // A stored role this build cannot read is shown as the least privileged.
      role: teamRoleSchema.catch('member').parse(member.role),
      joinedAt: member.joinedAt.toISOString(),
      isSelf,
    };
  }
}
