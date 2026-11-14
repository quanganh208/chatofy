import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Personal library routes against team rows the caller authored, on a REAL
// Postgres.
//
// A team glossary or context keeps its author in `ownerId`. A personal route
// that filtered on `ownerId` alone would therefore list, rename, toggle, count
// and delete the author's TEAM rows — and keep doing so after the author left
// the team. This file seeds one team glossary (with one item) and one team
// context authored by the caller straight through Prisma, calls every personal
// library route with their ids, and after each call reads the team rows back to
// prove nothing reached them. No team route exists yet, so Prisma is the only
// way to create the rows; that is also what makes this independent of any
// team API.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import {
  glossaryItemListResponseSchema,
  glossaryListResponseSchema,
  translationContextListResponseSchema,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** The team rows' client ids, seeded through Prisma. */
const G = randomUUID();
const I = randomUUID();
const C = randomUUID();

describe('personal routes never reach team rows (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: Identity;
  let teamId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    alice = await registerAndLogin(app, {
      email: `alice-${run}@scope-db-e2e.example.com`,
    });

    const team = await prisma.team.create({
      data: {
        name: 'T',
        members: { create: { userId: alice.userId, role: 'owner' } },
      },
    });
    teamId = team.id;
    await prisma.glossary.create({
      data: {
        clientId: G,
        ownerId: alice.userId,
        teamId,
        name: 'Team G',
        sourceLang: 'vi',
        items: {
          create: {
            clientId: I,
            original: 'hội đồng',
            translation: 'board',
            targetLang: 'en',
          },
        },
      },
    });
    await prisma.translationContext.create({
      data: {
        clientId: C,
        ownerId: alice.userId,
        teamId,
        name: 'Team C',
        hotwords: [],
      },
    });
  });

  afterAll(async () => {
    // The team cascades its library; personal rows go by `ownerId`, which is a
    // plain column on both models.
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.glossary.deleteMany({ where: { ownerId: alice.userId } });
    await prisma.translationContext.deleteMany({
      where: { ownerId: alice.userId },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    // Every case calls from one address; reset the per-address budget so the
    // suite never asserts rate limiting by accident.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  const glossaryBody = { name: 'Renamed', description: null, sourceLang: 'vi' };
  const contextBody = {
    name: 'Renamed',
    topic: null,
    hotwords: [],
    style: null,
    glossary: [],
    glossaryId: null,
  };

  /**
   * One row per personal library route, each called by the team rows' author
   * with the team rows' ids. `PUT` is "not 2xx" rather than a code: the
   * `(ownerId, clientId)` unique spans the author's personal and team rows, so
   * a personal create under a team row's id answers 500. Client ids are random
   * UUIDs, so a real client never sends one; what matters is that the team row
   * survives it.
   */
  const matrix: {
    route: string;
    call: () => request.Test;
    expectResponse: (res: Response) => void;
  }[] = [
    {
      route: 'GET /glossaries',
      call: () => as(request(app.getHttpServer()).get('/glossaries')),
      expectResponse: (res) => {
        expect(res.status).toBe(200);
        const { glossaries } = successBody(
          res,
          glossaryListResponseSchema,
        ).data;
        expect(glossaries.map((g) => g.id)).not.toContain(G);
      },
    },
    {
      route: 'PUT /glossaries/:id',
      call: () =>
        as(request(app.getHttpServer()).put(`/glossaries/${G}`)).send(
          glossaryBody,
        ),
      expectResponse: (res) => expectNot2xx(res),
    },
    {
      route: 'PATCH /glossaries/:id',
      call: () =>
        as(request(app.getHttpServer()).patch(`/glossaries/${G}`)).send({
          isActive: false,
        }),
      expectResponse: (res) => expect(res.status).toBe(404),
    },
    {
      route: 'DELETE /glossaries/:id',
      call: () => as(request(app.getHttpServer()).delete(`/glossaries/${G}`)),
      expectResponse: (res) => expect(res.status).toBe(204),
    },
    {
      route: 'GET /glossaries/:id/items',
      call: () =>
        as(request(app.getHttpServer()).get(`/glossaries/${G}/items`)),
      expectResponse: (res) => {
        expect(res.status).toBe(200);
        expect(
          successBody(res, glossaryItemListResponseSchema).data.items,
        ).toEqual([]);
      },
    },
    {
      route: 'POST /glossaries/:id/items',
      call: () =>
        as(request(app.getHttpServer()).post(`/glossaries/${G}/items`)).send({
          clientId: randomUUID(),
          original: 'luận văn',
          translation: 'thesis',
          targetLang: 'en',
          notes: null,
        }),
      expectResponse: (res) => expect(res.status).toBe(409),
    },
    {
      route: 'DELETE /glossaries/:id/items/:itemId',
      call: () =>
        as(request(app.getHttpServer()).delete(`/glossaries/${G}/items/${I}`)),
      expectResponse: (res) => expect(res.status).toBe(204),
    },
    {
      route: 'GET /translation-contexts',
      call: () => as(request(app.getHttpServer()).get('/translation-contexts')),
      expectResponse: (res) => {
        expect(res.status).toBe(200);
        const { contexts } = successBody(
          res,
          translationContextListResponseSchema,
        ).data;
        expect(contexts.map((c) => c.id)).not.toContain(C);
      },
    },
    {
      route: 'PUT /translation-contexts/:id',
      call: () =>
        as(request(app.getHttpServer()).put(`/translation-contexts/${C}`)).send(
          contextBody,
        ),
      expectResponse: (res) => expectNot2xx(res),
    },
    {
      route: 'DELETE /translation-contexts/:id',
      call: () =>
        as(request(app.getHttpServer()).delete(`/translation-contexts/${C}`)),
      expectResponse: (res) => expect(res.status).toBe(204),
    },
  ];

  it.each(matrix)(
    '$route leaves the team rows untouched',
    async ({ call, expectResponse }) => {
      expectResponse(await call());
      await expectTeamRowsUntouched();
    },
  );

  it('personal quota ignores team authorship', async () => {
    // 20 team glossaries authored by alice: the seeded one plus 19 more. A
    // personal count that included them would refuse her very first create.
    await prisma.glossary.createMany({
      data: Array.from({ length: 19 }, (_, index) => ({
        clientId: randomUUID(),
        ownerId: alice.userId,
        teamId,
        name: `Team extra ${index}`,
        sourceLang: 'vi',
      })),
    });

    for (let index = 0; index < 20; index += 1) {
      await as(request(app.getHttpServer()).put(`/glossaries/${randomUUID()}`))
        .send({ ...glossaryBody, name: `Personal ${index}` })
        .expect(200);
    }
    await expectTeamRowsUntouched();
  });

  function as(test: request.Test): request.Test {
    return test.set('authorization', alice.bearer);
  }

  /** The seeded team rows, read straight from Postgres, are as they were seeded. */
  async function expectTeamRowsUntouched(): Promise<void> {
    const glossary = await prisma.glossary.findFirst({
      where: { clientId: G, teamId },
      select: {
        name: true,
        isActive: true,
        _count: { select: { items: true } },
      },
    });
    expect(glossary).toEqual({
      name: 'Team G',
      isActive: true,
      _count: { items: 1 },
    });
    const context = await prisma.translationContext.findFirst({
      where: { clientId: C, teamId },
      select: { name: true },
    });
    expect(context).toEqual({ name: 'Team C' });
  }
});

function expectNot2xx(res: Response): void {
  expect(res.status >= 200 && res.status < 300).toBe(false);
}
