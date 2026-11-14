import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  TEAM_LIMITS,
  inviteRoleSchema,
  teamRoleSchema,
  type InvitePreviewResponse,
  type InvitePreviewStatus,
  type InviteRefusalStatus,
  type TeamSummary,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { CodedHttpException } from '../../../common/exceptions/coded-http.exception';
import { normalizeEmail } from '../../auth/normalize-email';
import { TeamAccessService } from '../team-access.service';
import { lockTeam, lockUser } from '../team-locks';
import { TEAM_SUMMARY_SELECT, toTeamSummary } from '../team-summary';
import { hashInviteToken } from './team-invite-token';

/** The invite columns status is derived from. */
interface InviteState {
  id: string;
  teamId: string;
  role: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

/** Either the shared client or a transaction: `statusOf` reads only members. */
type MemberReader = Pick<Prisma.TransactionClient, 'teamMember'>;

/** What accept answers with 409 INVITE_NOT_PENDING, per refused status. */
const REFUSAL_MESSAGE: Record<InviteRefusalStatus, string> = {
  accepted: 'This invite has already been used.',
  revoked: 'This invite was withdrawn.',
  expired: 'This invite has expired.',
  'team-cap': `You can be in at most ${TEAM_LIMITS.MAX_TEAMS_PER_USER} teams.`,
  'team-full': 'This team is full.',
};

const NOT_VALID = 'This invite link is not valid.';

/**
 * The invitee's side of an invite: preview it without spending it, then
 * accept it once.
 *
 * An invite is bound to the address it was sent to: the caller must be signed
 * in as that address (`User` rows exist only for verified addresses). Preview
 * and accept derive the status through the one {@link statusOf}, so they
 * never disagree on which refusal wins.
 */
@Injectable()
export class TeamInviteAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TeamAccessService,
  ) {}

  async preview(userId: string, token: string): Promise<InvitePreviewResponse> {
    const { invite, emailMatches } = await this.load(userId, token);
    if (!emailMatches) {
      return {
        status: 'wrong-account',
        teamName: null,
        role: null,
        inviterEmail: null,
      };
    }
    const status = await statusOf(this.prisma, invite, userId);
    const inviter = await this.prisma.user.findUnique({
      where: { id: invite.invitedById },
      select: { email: true },
    });
    const role = inviteRoleSchema.safeParse(invite.role);
    return {
      status,
      teamName: invite.team.name,
      role: role.success ? role.data : null,
      inviterEmail: inviter?.email ?? null,
    };
  }

  async accept(userId: string, token: string): Promise<TeamSummary> {
    const { invite, emailMatches } = await this.load(userId, token);
    if (!emailMatches) {
      throw new ForbiddenException(
        'This invite was sent to a different email address. Sign in with that address to accept it.',
      );
    }

    // Nothing in here reads on the shared client: the locks are held until
    // the commit, and a second pooled connection waiting behind them is how
    // a burst starves the pool.
    const existing = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await lockTeam(tx, invite.teamId);

      const current = await tx.teamInvite.findUnique({
        where: { id: invite.id },
        select: INVITE_STATE_SELECT,
      });
      // The team was deleted after the load, and its invites went with it.
      if (current === null) throw new NotFoundException(NOT_VALID);

      const status = await statusOf(tx, current, userId);
      if (status === 'already-member') {
        // Idempotent, and the token stays unspent.
        return summaryOn(tx, current.teamId, userId);
      }
      if (status !== 'pending') {
        throw refusal(status);
      }

      const now = new Date();
      const claimed = await tx.teamInvite.updateMany({
        where: {
          id: current.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) throw refusal('accepted');
      const role = inviteRoleSchema.safeParse(current.role);
      await tx.teamMember.create({
        data: {
          teamId: current.teamId,
          userId,
          role: role.success ? role.data : 'member',
        },
      });
      return null;
    });
    if (existing !== null) return existing;

    // After the commit, through the same mapping `GET /teams` uses.
    const joined = (await this.access.memberships(userId)).find(
      (m) => m.scope.teamId === invite.teamId,
    );
    if (joined === undefined) {
      throw new InternalServerErrorException('The membership was not saved.');
    }
    return joined.team;
  }

  /** The invite behind a token, and whether the caller is its addressee. */
  private async load(userId: string, token: string) {
    const invite = await this.prisma.teamInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: {
        ...INVITE_STATE_SELECT,
        email: true,
        invitedById: true,
        team: { select: { name: true } },
      },
    });
    if (invite === null) throw new NotFoundException(NOT_VALID);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return {
      invite,
      emailMatches:
        user !== null && normalizeEmail(user.email) === invite.email,
    };
  }
}

const INVITE_STATE_SELECT = {
  id: true,
  teamId: true,
  role: true,
  acceptedAt: true,
  revokedAt: true,
  expiresAt: true,
} as const;

/**
 * The first status that applies, in this order, else `pending`. The order is
 * the contract: a spent invite reads as spent before anything about the
 * caller is checked.
 */
async function statusOf(
  client: MemberReader,
  invite: InviteState,
  userId: string,
): Promise<Exclude<InvitePreviewStatus, 'wrong-account'>> {
  if (invite.acceptedAt !== null) return 'accepted';
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.expiresAt <= new Date()) return 'expired';
  const member = await client.teamMember.findUnique({
    where: { teamId_userId: { teamId: invite.teamId, userId } },
    select: { id: true },
  });
  if (member !== null) return 'already-member';
  if (
    (await client.teamMember.count({ where: { userId } })) >=
    TEAM_LIMITS.MAX_TEAMS_PER_USER
  ) {
    return 'team-cap';
  }
  if (
    (await client.teamMember.count({ where: { teamId: invite.teamId } })) >=
    TEAM_LIMITS.MAX_SEATS_PER_TEAM
  ) {
    return 'team-full';
  }
  return 'pending';
}

/** 409 INVITE_NOT_PENDING, naming the status in `details` so no client matches text. */
function refusal(status: InviteRefusalStatus): CodedHttpException {
  return new CodedHttpException(
    'INVITE_NOT_PENDING',
    409,
    REFUSAL_MESSAGE[status],
    [{ path: 'status', message: status }],
  );
}

/** The caller's existing membership as a summary, read on the transaction. */
async function summaryOn(
  tx: Prisma.TransactionClient,
  teamId: string,
  userId: string,
): Promise<TeamSummary> {
  const row = await tx.teamMember.findUniqueOrThrow({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, team: { select: TEAM_SUMMARY_SELECT } },
  });
  const role = teamRoleSchema.safeParse(row.role);
  if (!role.success) throw new NotFoundException('Team not found.');
  return toTeamSummary(row.team, role.data);
}
