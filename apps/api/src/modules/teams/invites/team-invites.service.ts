import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asLocale, DEFAULT_LOCALE } from '@chatofy/i18n';
import {
  TEAM_LIMITS,
  inviteRoleSchema,
  teamRoleSchema,
  type CreateTeamInviteRequest,
  type TeamInvite,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthMailer } from '../../auth/auth-mailer';
import { normalizeEmail } from '../../auth/normalize-email';
import {
  MailBudgetClass,
  MailPurpose,
} from '../../mail/interfaces/mail-sender.interface';
import { TeamAccessService } from '../team-access.service';
import { lockTeam, lockUser } from '../team-locks';
import { mintInviteToken } from './team-invite-token';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/**
 * The mail guard drops a second mail of one purpose to one address inside
 * this window, keyed on the address alone. Refusing the invite here is what
 * keeps the API from answering 201 for a mail that will never be sent.
 *
 * One minute longer than the guard's 10: the guard counts from the send,
 * which lands a moment after this row's `createdAt`, so a window of exactly
 * 10 minutes here would let a re-invite at the boundary through.
 */
const MAIL_COOLDOWN_MS = 11 * MINUTE_MS;

interface InviteRow {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Creating, listing and withdrawing a team's invites. Admins and the owner
 * only; an admin invites members, the owner may also invite admins.
 *
 * An invite is never sent twice. Every mail is one row, so the per-inviter daily cap
 * counts every mail sent; to repeat an invite, withdraw it and invite again.
 *
 * **Lock rule:** while a transaction holds a membership lock, nothing reads
 * on the shared client. The role check before the transaction is only the
 * 404/403 gate; the role that decides is re-read on `tx` after the locks.
 */
@Injectable()
export class TeamInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TeamAccessService,
    private readonly mailer: AuthMailer,
  ) {}

  async create(
    userId: string,
    teamId: string,
    body: CreateTeamInviteRequest,
  ): Promise<TeamInvite> {
    await this.access.resolve(userId, teamId, 'admin');
    const email = normalizeEmail(body.email);

    const { row, token, inviteeLocale } = await this.prisma.$transaction(
      async (tx) => {
        // The inviter's key first: the daily cap counts across their teams.
        await lockUser(tx, userId);
        await lockTeam(tx, teamId);

        const caller = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId } },
          select: { role: true },
        });
        const callerRole = teamRoleSchema.safeParse(caller?.role);
        if (caller === null || !callerRole.success) {
          throw new NotFoundException('Team not found.');
        }
        if (callerRole.data === 'member') {
          throw new ForbiddenException(
            'Your role in this team does not allow this.',
          );
        }
        if (body.role === 'admin' && callerRole.data !== 'owner') {
          throw new ForbiddenException('Only the owner can invite an admin.');
        }

        const now = new Date();
        const invitee = await tx.user.findUnique({
          where: { email },
          select: { id: true, locale: true },
        });
        if (invitee !== null) {
          const member = await tx.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: invitee.id } },
            select: { id: true },
          });
          if (member !== null) {
            throw new ConflictException('This person is already in the team.');
          }
        }

        const live = {
          teamId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        };
        const pending = await tx.teamInvite.findFirst({
          where: { ...live, email },
          select: { id: true },
        });
        if (pending !== null) {
          throw new ConflictException(
            'An invite to this address is already pending. Withdraw it to send a new one.',
          );
        }

        const recent = await tx.teamInvite.findFirst({
          where: {
            email,
            createdAt: { gt: new Date(now.getTime() - MAIL_COOLDOWN_MS) },
          },
          select: { id: true },
        });
        if (recent !== null) {
          throw new ConflictException(
            'An invite to this address was sent recently. Try again in a few minutes.',
          );
        }

        // Seats are members plus live invites. Expired, accepted and withdrawn
        // invites never count, and nothing can bring them back.
        const seats =
          (await tx.teamMember.count({ where: { teamId } })) +
          (await tx.teamInvite.count({ where: live }));
        if (seats >= TEAM_LIMITS.MAX_SEATS_PER_TEAM) {
          throw new ConflictException('This team has no seats left.');
        }

        const sentToday = await tx.teamInvite.count({
          where: {
            invitedById: userId,
            createdAt: { gt: new Date(now.getTime() - DAY_MS) },
          },
        });
        if (sentToday >= TEAM_LIMITS.MAX_INVITES_PER_INVITER_PER_DAY) {
          throw new HttpException(
            'You have sent too many invites today. Try again tomorrow.',
            429,
          );
        }

        const minted = mintInviteToken();
        const created = await tx.teamInvite.create({
          data: {
            teamId,
            email,
            role: body.role,
            tokenHash: minted.tokenHash,
            invitedById: userId,
            expiresAt: new Date(
              now.getTime() + TEAM_LIMITS.INVITE_TTL_DAYS * DAY_MS,
            ),
          },
          select: INVITE_SELECT,
        });
        return {
          row: created,
          token: minted.token,
          inviteeLocale: invitee?.locale ?? null,
        };
      },
    );

    // After the commit: the inviter's locale is read on the shared client,
    // which is safe only once no lock is held.
    const inviter = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    this.mailer.dispatch({
      to: email,
      purpose: MailPurpose.TeamInvite,
      budgetClass: MailBudgetClass.AttackerTriggerable,
      link: this.mailer.link('/invite', token),
      locale:
        asLocale(inviteeLocale) ?? asLocale(inviter?.locale) ?? DEFAULT_LOCALE,
    });
    return toInvite(row, new Date());
  }

  /** Open invites (not accepted, not withdrawn), newest first; expired ones are marked. */
  async list(userId: string, teamId: string): Promise<TeamInvite[]> {
    await this.access.resolve(userId, teamId, 'admin');
    const rows = await this.prisma.teamInvite.findMany({
      where: { teamId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: INVITE_SELECT,
    });
    const now = new Date();
    return rows.map((row) => toInvite(row, now));
  }

  /** Withdraw an open invite. Idempotent: an unknown or spent id is a no-op. */
  async revoke(
    userId: string,
    teamId: string,
    inviteId: string,
  ): Promise<void> {
    await this.access.resolve(userId, teamId, 'admin');
    await this.prisma.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      await tx.teamInvite.updateMany({
        where: { id: inviteId, teamId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}

const INVITE_SELECT = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** A stored role this build cannot read is shown as `member`, the lesser grant. */
function toInvite(row: InviteRow, now: Date): TeamInvite {
  const role = inviteRoleSchema.safeParse(row.role);
  return {
    id: row.id,
    email: row.email,
    role: role.success ? role.data : 'member',
    status: row.expiresAt <= now ? 'expired' : 'pending',
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
