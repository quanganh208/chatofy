import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Teams, members and roles against a REAL Postgres.
//
// The role rules are a decision table (owner / admin / member / outsider by
// action), and a table is only proved by running every cell against the real
// guard and the real membership rows. Admins and members are seeded straight
// through Prisma, because invites are a separate feature; every `:memberId`
// below is a TeamMember row id, never a user id.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import {
  teamListResponseSchema,
  teamMemberListResponseSchema,
  teamMemberResponseSchema,
  teamResponseSchema,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Teams (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: Identity;
  let admin: Identity;
  let member: Identity;
  let outsider: Identity;
  let teamId: string;
  let oId: string;
  let aId: string;
  let mId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    owner = await who('owner');
    admin = await who('admin');
    member = await who('member');
    outsider = await who('outsider');
  });

  afterAll(async () => {
    const ids = [owner, admin, member, outsider].map((i) => i.userId);
    await prisma.team.deleteMany({
      where: { members: { some: { userId: { in: ids } } } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    // Every case calls from one address and several accounts; reset the
    // throttle budget so a case never asserts rate limiting by accident.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  it('creates a team and lists the caller as owner', async () => {
    const created = await call(owner, 'post', '/teams')
      .send({ name: 'T' })
      .expect(201);
    teamId = successBody(created, teamResponseSchema).data.team.id;

    const listed = await call(owner, 'get', '/teams').expect(200);
    expect(
      successBody(listed, teamListResponseSchema).data.teams,
    ).toContainEqual(
      expect.objectContaining({
        id: teamId,
        name: 'T',
        role: 'owner',
        memberCount: 1,
      }),
    );
    expect(
      await prisma.teamMember.count({
        where: { teamId, userId: owner.userId, role: 'owner' },
      }),
    ).toBe(1);

    await prisma.teamMember.createMany({
      data: [
        { teamId, userId: admin.userId, role: 'admin' },
        { teamId, userId: member.userId, role: 'member' },
      ],
    });
    oId = await memberId(owner);
    aId = await memberId(admin);
    mId = await memberId(member);
  });

  it('a non-member gets 404 everywhere', async () => {
    // Valid bodies throughout: validation answers 400 before membership.
    await call(outsider, 'get', `/teams/${teamId}/members`).expect(404);
    await call(outsider, 'patch', `/teams/${teamId}`)
      .send({ name: 'X' })
      .expect(404);
    await call(outsider, 'delete', `/teams/${teamId}`).expect(404);
    await call(outsider, 'patch', `/teams/${teamId}/members/${mId}`)
      .send({ role: 'admin' })
      .expect(404);
    await call(outsider, 'delete', `/teams/${teamId}/members/${mId}`).expect(
      404,
    );
  });

  it('a member is refused management', async () => {
    await call(member, 'patch', `/teams/${teamId}`)
      .send({ name: 'M' })
      .expect(403);
    await call(member, 'delete', `/teams/${teamId}`).expect(403);
    await call(member, 'patch', `/teams/${teamId}/members/${aId}`)
      .send({ role: 'member' })
      .expect(403);
    await call(member, 'delete', `/teams/${teamId}/members/${aId}`).expect(403);

    const listed = membersOf(
      await call(member, 'get', `/teams/${teamId}/members`).expect(200),
    );
    expect(listed).toHaveLength(3);
    expect(listed.filter((m) => m.isSelf)).toHaveLength(1);
  });

  it('a member sees no teammate email and no user id', async () => {
    const res = await call(member, 'get', `/teams/${teamId}/members`).expect(
      200,
    );
    const listed = membersOf(res);
    for (const entry of listed.filter((m) => !m.isSelf)) {
      expect(entry.email).toBeNull();
    }
    expect(listed.find((m) => m.isSelf)?.email).toBe(member.email);
    const raw = JSON.stringify(res.body);
    for (const id of [owner.userId, admin.userId, member.userId]) {
      expect(raw).not.toContain(id);
    }

    for (const viewer of [owner, admin]) {
      const seen = membersOf(
        await call(viewer, 'get', `/teams/${teamId}/members`).expect(200),
      );
      for (const entry of seen) expect(entry.email).not.toBeNull();
    }
  });

  it('an admin removes members but not admins or the owner', async () => {
    await call(admin, 'patch', `/teams/${teamId}`)
      .send({ name: 'A' })
      .expect(403);
    await call(admin, 'delete', `/teams/${teamId}/members/${oId}`).expect(403);
    await call(admin, 'patch', `/teams/${teamId}/members/${mId}`)
      .send({ role: 'admin' })
      .expect(403);
  });

  it('only the owner changes roles; the owner cannot leave', async () => {
    const promoted = await call(
      owner,
      'patch',
      `/teams/${teamId}/members/${mId}`,
    )
      .send({ role: 'admin' })
      .expect(200);
    expect(
      successBody(promoted, teamMemberResponseSchema).data.member.role,
    ).toBe('admin');
    await call(owner, 'patch', `/teams/${teamId}/members/${mId}`)
      .send({ role: 'member' })
      .expect(200);

    await call(owner, 'delete', `/teams/${teamId}/members/${oId}`).expect(409);
    await call(owner, 'patch', `/teams/${teamId}/members/${oId}`)
      .send({ role: 'member' })
      .expect(409);
  });

  it('removal is immediate', async () => {
    await call(admin, 'delete', `/teams/${teamId}/members/${mId}`).expect(204);

    await call(member, 'get', `/teams/${teamId}/members`).expect(404);
    const listed = await call(member, 'get', '/teams').expect(200);
    expect(
      successBody(listed, teamListResponseSchema).data.teams.map((t) => t.id),
    ).not.toContain(teamId);
  });

  it('a member may leave', async () => {
    await prisma.teamMember.create({
      data: { teamId, userId: member.userId, role: 'member' },
    });
    const rejoined = await memberId(member);

    await call(member, 'delete', `/teams/${teamId}/members/${rejoined}`).expect(
      204,
    );
    expect(
      await prisma.teamMember.count({
        where: { teamId, userId: member.userId },
      }),
    ).toBe(0);
  });

  it('the sixth team is refused', async () => {
    // Seeded through Prisma, never the API: POST /teams allows 5 a minute per
    // account, so a sixth POST in one case would answer 429, not 409.
    for (let index = 0; index < 5; index += 1) {
      await prisma.team.create({
        data: {
          name: `X${index}`,
          members: { create: { userId: outsider.userId, role: 'owner' } },
        },
      });
    }
    await call(outsider, 'post', '/teams').send({ name: 'X6' }).expect(409);
  });

  it('rename validates', async () => {
    await call(owner, 'patch', `/teams/${teamId}`)
      .send({ name: '' })
      .expect(400);
    const renamed = await call(owner, 'patch', `/teams/${teamId}`)
      .send({ name: 'T2' })
      .expect(200);
    expect(successBody(renamed, teamResponseSchema).data.team.name).toBe('T2');
  });

  it('only the owner deletes; delete cascades', async () => {
    await call(admin, 'delete', `/teams/${teamId}`).expect(403);
    await call(owner, 'delete', `/teams/${teamId}`).expect(204);
    expect(await prisma.teamMember.count({ where: { teamId } })).toBe(0);
  });

  function call(
    as: Identity,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ): request.Test {
    return request(app.getHttpServer())
      [method](path)
      .set('authorization', as.bearer);
  }

  function membersOf(res: Response) {
    return successBody(res, teamMemberListResponseSchema).data.members;
  }

  async function memberId(as: Identity): Promise<string> {
    const row = await prisma.teamMember.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: as.userId } },
      select: { id: true },
    });
    return row.id;
  }

  function who(label: string): Promise<Identity> {
    return registerAndLogin(app, {
      email: `${label}-${run}@teams-db-e2e.example.com`,
    });
  }
});
