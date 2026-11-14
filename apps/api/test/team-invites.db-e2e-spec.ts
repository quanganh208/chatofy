import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Team invites against a REAL Postgres, with the mail sender recorded.
//
// Throttle rule: invite create and team create are 5/min per user, so every
// case below makes at most 4 such calls as one identity, and every
// precondition (prior invites, prior memberships) is seeded through Prisma.
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import {
  acceptInviteResponseSchema,
  invitePreviewResponseSchema,
  teamInviteResponseSchema,
  teamListResponseSchema,
  teamResponseSchema,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import {
  MAIL_SENDER,
  MailBudgetClass,
  MailPurpose,
  type MailDispatch,
  type MailSender,
} from '../src/modules/mail/interfaces/mail-sender.interface';
import { mintInviteToken } from '../src/modules/teams/invites/team-invite-token';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { errorBody, successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (name: string) => `${name}-${run}@db-e2e.example.com`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms);

describe('Team invites (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const identities: Identity[] = [];
  let O: Identity;
  let A: Identity;
  let M: Identity;
  let B: Identity;
  let W: Identity;
  let X: Identity;
  let T: string;
  /** B's invite, mailed by the first case and spent by the second. */
  let bToken: string;

  /** Every mail the API dispatched, so a case can read the real link. */
  const sentMail: MailDispatch[] = [];
  const recordingMail: MailSender = {
    send: async (dispatch) => {
      sentMail.push(dispatch);
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_SENDER)
      .useValue(recordingMail)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    O = await who('owner');
    A = await who('admin');
    M = await who('member');
    B = await who('invitee');
    W = await who('wrong');
    X = await who('outsider');

    const created = await call(O, 'post', '/teams')
      .send({ name: 'Clinic' })
      .expect(201);
    T = successBody(created, teamResponseSchema).data.team.id;
    await prisma.teamMember.createMany({
      data: [
        { teamId: T, userId: A.userId, role: 'admin' },
        { teamId: T, userId: M.userId, role: 'member' },
      ],
    });
  });

  afterAll(async () => {
    const ids = identities.map((i) => i.userId);
    await prisma.team.deleteMany({
      where: { members: { some: { userId: { in: ids } } } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  it('invite stores a hash and mails a single-use link', async () => {
    const res = await call(O, 'post', `/teams/${T}/invites`)
      .send({ email: B.email.toUpperCase(), role: 'member' })
      .expect(201);
    const invite = successBody(res, teamInviteResponseSchema).data.invite;
    expect(invite).toMatchObject({ email: B.email, status: 'pending' });
    // The raw body: the zod helper would strip a key the API must never send.
    expect(res.body.data.invite).not.toHaveProperty('token');
    expect(res.body.data.invite).not.toHaveProperty('tokenHash');

    await vi.waitFor(() =>
      expect(
        sentMail.some(
          (m) => m.purpose === MailPurpose.TeamInvite && m.to === B.email,
        ),
      ).toBe(true),
    );
    const mail = sentMail.find((m) => m.to === B.email)!;
    // An authenticated caller names an arbitrary recipient.
    expect(mail.budgetClass).toBe(MailBudgetClass.AttackerTriggerable);
    expect(JSON.stringify(res.body)).not.toContain(
      new URL(mail.link).searchParams.get('token')!,
    );
    const url = new URL(mail.link);
    expect(url.pathname).toBe('/invite');
    bToken = url.searchParams.get('token')!;
    expect(bToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await prisma.teamInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).toBe(
      createHash('sha256').update(bToken).digest('hex'),
    );
    expect(JSON.stringify(row)).not.toContain(bToken);
  });

  it('preview spends nothing; the wrong account is refused and leaves the token unspent', async () => {
    const wrong = await preview(W, bToken).expect(200);
    expect(previewOf(wrong)).toEqual({
      status: 'wrong-account',
      teamName: null,
      role: null,
      inviterEmail: null,
    });
    await accept(W, bToken).expect(403);
    expect(await acceptedAt(bToken)).toBeNull();

    const right = await preview(B, bToken).expect(200);
    expect(previewOf(right)).toEqual({
      status: 'pending',
      teamName: 'Clinic',
      role: 'member',
      inviterEmail: O.email,
    });
    expect(await acceptedAt(bToken)).toBeNull();
  });

  it('accept once, then reuse is refused', async () => {
    const joined = await accept(B, bToken).expect(200);
    expect(
      successBody(joined, acceptInviteResponseSchema).data.team,
    ).toMatchObject({ id: T, role: 'member' });
    const teams = await call(B, 'get', '/teams').expect(200);
    expect(
      successBody(teams, teamListResponseSchema).data.teams.map((t) => t.id),
    ).toContain(T);

    const again = await accept(B, bToken).expect(409);
    expect(errorBody(again).error.code).toBe('INVITE_NOT_PENDING');
    expect(errorBody(again).error.details).toEqual([
      { path: 'status', message: 'accepted' },
    ]);
    expect(previewOf(await preview(B, bToken).expect(200)).status).toBe(
      'accepted',
    );
  });

  it('unknown, expired and revoked tokens', async () => {
    await accept(X, mintInviteToken().token).expect(404);

    const expired = await seedInvite(T, X.email, { expiresAt: ago(MINUTE) });
    const refusedExpired = await accept(X, expired.token).expect(409);
    expect(errorBody(refusedExpired).error.details?.[0]?.message).toBe(
      'expired',
    );

    const W2 = await who('withdrawn');
    const withdrawn = await seedInvite(T, W2.email);
    await call(O, 'delete', `/teams/${T}/invites/${withdrawn.row.id}`).expect(
      204,
    );
    const refusedRevoked = await accept(W2, withdrawn.token).expect(409);
    expect(errorBody(refusedRevoked).error.details?.[0]?.message).toBe(
      'revoked',
    );
  });

  it('the owner invites an admin, who joins as admin', async () => {
    const C = await who('co-admin');
    await call(O, 'post', `/teams/${T}/invites`)
      .send({ email: C.email, role: 'admin' })
      .expect(201);
    await vi.waitFor(() =>
      expect(sentMail.some((m) => m.to === C.email)).toBe(true),
    );
    const token = new URL(
      sentMail.find((m) => m.to === C.email)!.link,
    ).searchParams.get('token')!;
    expect(previewOf(await preview(C, token).expect(200)).role).toBe('admin');
    const joined = await accept(C, token).expect(200);
    expect(successBody(joined, acceptInviteResponseSchema).data.team.role).toBe(
      'admin',
    );
  });

  it('two accepts at once join once; the second reads the invite as used', async () => {
    const Q = await who('racer');
    const invite = await seedInvite(T, Q.email);
    const [first, second] = await Promise.all([
      accept(Q, invite.token),
      accept(Q, invite.token),
    ]);
    // The loser waits on the locks, re-reads the invite, and finds it spent:
    // a spent invite reads as spent before membership is checked.
    const [won, lost] =
      first.status === 200 ? [first, second] : [second, first];
    expect([won.status, lost.status]).toEqual([200, 409]);
    expect(errorBody(lost).error.code).toBe('INVITE_NOT_PENDING');
    expect(errorBody(lost).error.details).toEqual([
      { path: 'status', message: 'accepted' },
    ]);
    expect(
      await prisma.teamMember.count({ where: { teamId: T, userId: Q.userId } }),
    ).toBe(1);
    expect(await acceptedAt(invite.token)).not.toBeNull();
  });

  it('only admins list or withdraw invites', async () => {
    const open = await seedInvite(T, emailFor('listed'));
    await call(M, 'get', `/teams/${T}/invites`).expect(403);
    await call(M, 'delete', `/teams/${T}/invites/${open.row.id}`).expect(403);
    await call(X, 'get', `/teams/${T}/invites`).expect(404);
    await call(X, 'delete', `/teams/${T}/invites/${open.row.id}`).expect(404);
    const listed = await call(A, 'get', `/teams/${T}/invites`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(open.token);
    expect(JSON.stringify(listed.body)).toContain(open.row.id);
    await call(A, 'delete', `/teams/${T}/invites/${open.row.id}`).expect(204);
    expect(
      (
        await prisma.teamInvite.findUniqueOrThrow({
          where: { id: open.row.id },
        })
      ).revokedAt,
    ).not.toBeNull();
  });

  it('a member demoted from admin can no longer invite', async () => {
    const R = await who('demoted');
    await prisma.teamMember.create({
      data: { teamId: T, userId: R.userId, role: 'admin' },
    });
    await call(R, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('before-demotion'), role: 'member' })
      .expect(201);
    await prisma.teamMember.update({
      where: { teamId_userId: { teamId: T, userId: R.userId } },
      data: { role: 'member' },
    });
    await call(R, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('after-demotion'), role: 'member' })
      .expect(403);
  });

  it('invite permissions', async () => {
    await call(M, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('by-member'), role: 'member' })
      .expect(403);
    await call(A, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('admin-by-admin'), role: 'admin' })
      .expect(403);
    await call(A, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('member-by-admin'), role: 'member' })
      .expect(201);
    await call(X, 'post', `/teams/${T}/invites`)
      .send({ email: emailFor('by-outsider'), role: 'member' })
      .expect(404);
    await call(M, 'get', `/teams/${T}/invites`).expect(403);
  });

  describe('duplicates and caps', () => {
    it('refuses to invite a member', async () => {
      await call(O, 'post', `/teams/${T}/invites`)
        .send({ email: B.email, role: 'member' })
        .expect(409);
    });

    it('refuses a second live invite to one address', async () => {
      const address = emailFor('pending');
      await seedInvite(T, address, { createdAt: ago(12 * MINUTE) });
      const res = await call(O, 'post', `/teams/${T}/invites`)
        .send({ email: address, role: 'member' })
        .expect(409);
      expect(errorBody(res).error.message).toContain('already pending');
    });

    it('counts live invites as seats, and expired ones stop counting', async () => {
      const members = await prisma.teamMember.count({ where: { teamId: T } });
      const live = await prisma.teamInvite.count({
        where: {
          teamId: T,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      const seeded = await Promise.all(
        Array.from({ length: 20 - members - live }, (_, i) =>
          seedInvite(T, emailFor(`seat-${i}`), {
            createdAt: ago(12 * MINUTE),
          }),
        ),
      );
      const full = await call(O, 'post', `/teams/${T}/invites`)
        .send({ email: emailFor('one-too-many'), role: 'member' })
        .expect(409);
      expect(errorBody(full).error.message).toContain('no seats left');

      await prisma.teamInvite.updateMany({
        where: { id: { in: seeded.map((s) => s.row.id) } },
        data: { expiresAt: ago(MINUTE) },
      });
      await call(O, 'post', `/teams/${T}/invites`)
        .send({ email: emailFor('after-expiry'), role: 'member' })
        .expect(201);
    });

    it('refuses an inviter past 20 invites in 24 hours', async () => {
      const D = await who('daily');
      const TD = await seedTeam(D, 'Daily');
      // Expired, so the seat check passes; still within 24h, so they count.
      for (let i = 0; i < 20; i += 1) {
        await seedInvite(TD, emailFor(`daily-${i}`), {
          invitedById: D.userId,
          expiresAt: ago(MINUTE),
          createdAt: ago(12 * MINUTE),
        });
      }
      await call(D, 'post', `/teams/${TD}/invites`)
        .send({ email: emailFor('daily-21'), role: 'member' })
        .expect(429);
    });
  });

  it('two teams invite one address inside 10 minutes; the second is refused', async () => {
    const T3 = await seedTeam(O, 'Second clinic');
    const E = emailFor('two-teams');
    const first = await call(O, 'post', `/teams/${T}/invites`)
      .send({ email: E, role: 'member' })
      .expect(201);
    const second = await call(O, 'post', `/teams/${T3}/invites`)
      .send({ email: E, role: 'member' })
      .expect(409);
    expect(errorBody(second).error.message).toContain('sent recently');
    await vi.waitFor(() =>
      expect(sentMail.filter((m) => m.to === E)).toHaveLength(1),
    );

    const id = successBody(first, teamInviteResponseSchema).data.invite.id;
    await call(O, 'delete', `/teams/${T}/invites/${id}`).expect(204);
    const reinvite = await call(O, 'post', `/teams/${T}/invites`)
      .send({ email: E, role: 'member' })
      .expect(409);
    expect(errorBody(reinvite).error.message).toContain('sent recently');
  });

  it('the membership cap refuses accept without spending', async () => {
    const Y = await who('capped');
    for (let i = 0; i < 5; i += 1) await seedTeam(Y, `Y${i}`);
    const invite = await seedInvite(T, Y.email);

    expect(previewOf(await preview(Y, invite.token).expect(200)).status).toBe(
      'team-cap',
    );
    const refused = await accept(Y, invite.token).expect(409);
    expect(errorBody(refused).error.details?.[0]?.message).toBe('team-cap');
    expect(await acceptedAt(invite.token)).toBeNull();
  });

  it('accept re-checks seats', async () => {
    const Z = await who('seatless');
    const T4 = await seedTeam(O, 'Full');
    // `TeamMember.userId` is a plain column, so placeholder members need no user.
    await prisma.teamMember.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        teamId: T4,
        userId: `seat-${run}-${i}`,
        role: 'member',
      })),
    });
    const invite = await seedInvite(T4, Z.email);

    const refused = await accept(Z, invite.token).expect(409);
    expect(errorBody(refused).error.details?.[0]?.message).toBe('team-full');
    expect(await prisma.teamMember.count({ where: { teamId: T4 } })).toBe(20);
  });

  it('accept after the team is deleted returns 404', async () => {
    const V = await who('late');
    const T5 = await seedTeam(O, 'Gone');
    const invite = await seedInvite(T5, V.email);
    await call(O, 'delete', `/teams/${T5}`).expect(204);
    await accept(V, invite.token).expect(404);
  });

  /** A team owned by `owner`, seeded through Prisma so it spends no throttle. */
  async function seedTeam(owner: Identity, name: string): Promise<string> {
    const team = await prisma.team.create({
      data: {
        name,
        members: { create: { userId: owner.userId, role: 'owner' } },
      },
      select: { id: true },
    });
    return team.id;
  }

  /**
   * An invite row with a fresh token. `invitedById` defaults to a placeholder
   * (a plain column, no FK) so seeded rows never count toward a real
   * inviter's daily cap.
   */
  async function seedInvite(
    teamId: string,
    email: string,
    overrides: {
      expiresAt?: Date;
      createdAt?: Date;
      invitedById?: string;
    } = {},
  ) {
    const { token, tokenHash } = mintInviteToken();
    const row = await prisma.teamInvite.create({
      data: {
        teamId,
        email,
        role: 'member',
        tokenHash,
        invitedById: overrides.invitedById ?? 'seed-inviter',
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * DAY),
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
    return { row, token };
  }

  async function acceptedAt(token: string): Promise<Date | null> {
    const row = await prisma.teamInvite.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      select: { acceptedAt: true },
    });
    return row.acceptedAt;
  }

  function preview(as: Identity, token: string) {
    return call(as, 'post', '/team-invites/preview').send({ token });
  }

  function accept(as: Identity, token: string) {
    return call(as, 'post', '/team-invites/accept').send({ token });
  }

  function call(
    as: Identity,
    method: 'get' | 'post' | 'delete',
    path: string,
  ): request.Test {
    return request(app.getHttpServer())
      [method](path)
      .set('authorization', as.bearer);
  }

  async function who(label: string): Promise<Identity> {
    const identity = await registerAndLogin(app, {
      email: emailFor(`${label}-${randomUUID().slice(0, 8)}`),
    });
    identities.push(identity);
    return identity;
  }
});

function previewOf(res: Response) {
  return successBody(res, invitePreviewResponseSchema).data;
}
