import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Team glossaries and AI Contexts against a REAL Postgres.
//
// The author rule is a decision table (author / other member / admin /
// outsider by write route), so every cell runs against the real guard, the
// real membership rows and the real store transactions. Admins and members
// are seeded straight through Prisma, because invites are a separate feature.
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import { z } from 'zod';
import {
  availableTranslationContextsResponseSchema,
  glossaryItemSchema,
  glossaryListResponseSchema,
  glossarySchema,
  teamResponseSchema,
  translationContextListResponseSchema,
  translationContextSchema,
  type SaveTranslationContextRequest,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { errorBody, successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const glossaryBody = {
  name: 'Cardiology',
  description: null,
  sourceLang: 'vi',
};
const itemBody = () => ({
  clientId: randomUUID(),
  original: 'nhịp tim',
  translation: 'heart rate',
  targetLang: 'en',
  notes: null,
});
const contextBody = (
  over: Partial<SaveTranslationContextRequest> = {},
): SaveTranslationContextRequest => ({
  name: 'Cardiology consult',
  topic: 'a follow-up appointment',
  hotwords: ['ECG'],
  style: 'formal',
  glossary: [{ vi: 'huyết áp', en: 'blood pressure' }],
  glossaryId: null,
  ...over,
});

describe('Team libraries (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let O: Identity;
  let A: Identity;
  let M: Identity;
  let N: Identity;
  let X: Identity;
  let T: string;
  let T2: string;
  /** M's team glossary and its one item. */
  const G = randomUUID();
  let itemId: string;
  /** M's team context, and the one linking G. */
  const C = randomUUID();
  const C2 = randomUUID();
  /** M's personal glossary and personal context. */
  const P = randomUUID();
  const PC = randomUUID();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    O = await who('owner');
    A = await who('admin');
    M = await who('member');
    N = await who('other-member');
    X = await who('outsider');

    T = await createTeam(O, 'Clinic');
    await prisma.teamMember.createMany({
      data: [
        { teamId: T, userId: A.userId, role: 'admin' },
        { teamId: T, userId: M.userId, role: 'member' },
        { teamId: T, userId: N.userId, role: 'member' },
      ],
    });
  });

  afterAll(async () => {
    const ids = [O, A, M, N, X].map((i) => i.userId);
    await prisma.team.deleteMany({
      where: { id: { in: [T, T2].filter(Boolean) } },
    });
    await prisma.glossary.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.translationContext.deleteMany({
      where: { ownerId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    // Several accounts from one address; reset the throttle budget so a case
    // never asserts rate limiting by accident.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  it('a non-member gets 404 on every team library route', async () => {
    const id = randomUUID();
    // Valid bodies throughout, so validation cannot answer first.
    const routes = (team: string) =>
      [
        () => call(X, 'get', `/teams/${team}/glossaries`),
        () =>
          call(X, 'put', `/teams/${team}/glossaries/${id}`).send(glossaryBody),
        () =>
          call(X, 'patch', `/teams/${team}/glossaries/${id}`).send({
            isActive: false,
          }),
        () => call(X, 'delete', `/teams/${team}/glossaries/${id}`),
        () => call(X, 'get', `/teams/${team}/glossaries/${id}/items`),
        () =>
          call(X, 'post', `/teams/${team}/glossaries/${id}/items`).send(
            itemBody(),
          ),
        () => call(X, 'delete', `/teams/${team}/glossaries/${id}/items/${id}`),
        () => call(X, 'get', `/teams/${team}/translation-contexts`),
        () =>
          call(X, 'put', `/teams/${team}/translation-contexts/${id}`).send(
            contextBody(),
          ),
        () => call(X, 'delete', `/teams/${team}/translation-contexts/${id}`),
      ] as const;

    // A real team the caller is not in, and a well-formed cuid that names no team.
    for (const team of [T, 'cl0000000000000000000000x']) {
      for (const [index, route] of routes(team).entries()) {
        const res = await route();
        expect(res.status, `route ${index} on team ${team}`).toBe(404);
      }
    }
  });

  it('members create; only the author or an admin edits', async () => {
    const created = await call(M, 'put', `/teams/${T}/glossaries/${G}`)
      .send(glossaryBody)
      .expect(200);
    expect(glossaryOf(created)).toMatchObject({ id: G, canEdit: true });
    const added = await call(M, 'post', `/teams/${T}/glossaries/${G}/items`)
      .send(itemBody())
      .expect(201);
    itemId = successBody(added, z.object({ item: glossaryItemSchema })).data
      .item.id;

    const seenByN = await call(N, 'get', `/teams/${T}/glossaries`).expect(200);
    expect(glossaryIn(seenByN, G)).toMatchObject({ canEdit: false });

    await call(N, 'put', `/teams/${T}/glossaries/${G}`)
      .send(glossaryBody)
      .expect(403);
    await call(N, 'patch', `/teams/${T}/glossaries/${G}`)
      .send({ isActive: false })
      .expect(403);
    await call(N, 'delete', `/teams/${T}/glossaries/${G}`).expect(403);
    await call(N, 'post', `/teams/${T}/glossaries/${G}/items`)
      .send(itemBody())
      .expect(403);
    await call(
      N,
      'delete',
      `/teams/${T}/glossaries/${G}/items/${itemId}`,
    ).expect(403);
    await call(N, 'get', `/teams/${T}/glossaries/${G}/items`).expect(200);

    await call(A, 'put', `/teams/${T}/glossaries/${G}`)
      .send({ ...glossaryBody, name: 'Cardiology (admin)' })
      .expect(200);
    await call(
      A,
      'delete',
      `/teams/${T}/glossaries/${G}/items/${itemId}`,
    ).expect(204);
    expect(
      await prisma.glossary.count({ where: { teamId: T, clientId: G } }),
    ).toBe(1);

    const ctx = await call(M, 'put', `/teams/${T}/translation-contexts/${C}`)
      .send(contextBody())
      .expect(200);
    expect(contextOf(ctx)).toMatchObject({ id: C, canEdit: true });
    await call(N, 'put', `/teams/${T}/translation-contexts/${C}`)
      .send(contextBody({ name: 'Taken over' }))
      .expect(403);
    await call(N, 'delete', `/teams/${T}/translation-contexts/${C}`).expect(
      403,
    );
    await call(A, 'put', `/teams/${T}/translation-contexts/${C}`)
      .send(contextBody({ name: 'Cardiology consult (admin)' }))
      .expect(200);
    expect(
      await prisma.translationContext.count({
        where: { teamId: T, clientId: C },
      }),
    ).toBe(1);
  });

  it('a team context links only a team glossary', async () => {
    const linked = await call(
      M,
      'put',
      `/teams/${T}/translation-contexts/${C2}`,
    )
      .send(contextBody({ glossaryId: G }))
      .expect(200);
    expect(contextOf(linked).linkedGlossaryId).toBe(G);

    await call(M, 'put', `/glossaries/${P}`).send(glossaryBody).expect(200);
    await call(M, 'put', `/teams/${T}/translation-contexts/${randomUUID()}`)
      .send(contextBody({ glossaryId: P }))
      .expect(400);
  });

  it('a team create refuses an id that exists anywhere', async () => {
    const glossaryClash = await call(M, 'put', `/teams/${T}/glossaries/${P}`)
      .send(glossaryBody)
      .expect(409);
    expect(errorBody(glossaryClash).error.message).toContain('already used');
    expect(await prisma.glossary.count({ where: { clientId: P } })).toBe(1);

    T2 = await createTeam(O, 'Second clinic');
    await prisma.teamMember.create({
      data: { teamId: T2, userId: M.userId, role: 'member' },
    });
    const contextClash = await call(
      M,
      'put',
      `/teams/${T2}/translation-contexts/${C}`,
    )
      .send(contextBody())
      .expect(409);
    expect(errorBody(contextClash).error.message).toContain('already used');
    expect(
      await prisma.translationContext.count({ where: { clientId: C } }),
    ).toBe(1);
  });

  it('the 21st team glossary or context is refused', async () => {
    const seededGlossaries = Array.from(
      { length: 20 - (await prisma.glossary.count({ where: { teamId: T } })) },
      () => ({
        teamId: T,
        ownerId: O.userId,
        clientId: randomUUID(),
        name: 'Seeded',
        sourceLang: 'vi',
      }),
    );
    const seededContexts = Array.from(
      {
        length:
          20 -
          (await prisma.translationContext.count({ where: { teamId: T } })),
      },
      () => ({
        teamId: T,
        ownerId: O.userId,
        clientId: randomUUID(),
        name: 'Seeded',
        hotwords: [],
      }),
    );
    await prisma.glossary.createMany({ data: seededGlossaries });
    await prisma.translationContext.createMany({ data: seededContexts });
    try {
      const glossary = await call(
        O,
        'put',
        `/teams/${T}/glossaries/${randomUUID()}`,
      )
        .send(glossaryBody)
        .expect(409);
      expect(errorBody(glossary).error.message).toMatch(
        /at most 20 glossaries/,
      );

      const context = await call(
        O,
        'put',
        `/teams/${T}/translation-contexts/${randomUUID()}`,
      )
        .send(contextBody())
        .expect(409);
      expect(errorBody(context).error.message).toMatch(
        /at most 20 AI Contexts/,
      );
    } finally {
      await prisma.glossary.deleteMany({
        where: { clientId: { in: seededGlossaries.map((g) => g.clientId) } },
      });
      await prisma.translationContext.deleteMany({
        where: { clientId: { in: seededContexts.map((c) => c.clientId) } },
      });
    }
  });

  it('personal lists never show team rows the caller authored', async () => {
    const glossaries = await call(M, 'get', '/glossaries').expect(200);
    const glossaryIds = successBody(
      glossaries,
      glossaryListResponseSchema,
    ).data.glossaries.map((g) => g.id);
    expect(glossaryIds).toContain(P);
    expect(glossaryIds).not.toContain(G);

    const contexts = await call(M, 'get', '/translation-contexts').expect(200);
    const contextIds = successBody(
      contexts,
      translationContextListResponseSchema,
    ).data.contexts.map((c) => c.id);
    expect(contextIds).not.toContain(C);
    expect(contextIds).not.toContain(C2);
  });

  it('available groups personal and team contexts in join order', async () => {
    await call(M, 'put', `/translation-contexts/${PC}`)
      .send(contextBody({ name: 'Personal' }))
      .expect(200);

    const mine = availableOf(
      await call(M, 'get', '/translation-contexts/available').expect(200),
    );
    expect(mine.personal.map((c) => c.id)).toContain(PC);
    expect(mine.teams).toHaveLength(2);
    expect(mine.teams[0]).toMatchObject({ teamId: T, name: 'Clinic' });
    expect(mine.teams[0]!.contexts.map((c) => c.id)).toContain(C);
    expect(mine.teams[1]!.teamId).toBe(T2);

    const outsiders = availableOf(
      await call(X, 'get', '/translation-contexts/available').expect(200),
    );
    expect(outsiders.teams).toEqual([]);
  });

  it('a removed member loses access; their rows stay', async () => {
    const row = await prisma.teamMember.findUniqueOrThrow({
      where: { teamId_userId: { teamId: T, userId: M.userId } },
      select: { id: true },
    });
    await call(O, 'delete', `/teams/${T}/members/${row.id}`).expect(204);

    await call(M, 'get', `/teams/${T}/glossaries`).expect(404);
    expect(
      await prisma.glossary.count({ where: { teamId: T, clientId: G } }),
    ).toBe(1);
    const seenByO = await call(O, 'get', `/teams/${T}/glossaries`).expect(200);
    expect(glossaryIn(seenByO, G)).toMatchObject({ canEdit: true });
  });

  it("deleting an author's account keeps their team rows", async () => {
    const GN = randomUUID();
    const CN = randomUUID();
    await call(N, 'put', `/teams/${T}/glossaries/${GN}`)
      .send(glossaryBody)
      .expect(200);
    await call(N, 'put', `/teams/${T}/translation-contexts/${CN}`)
      .send(contextBody())
      .expect(200);

    await prisma.user.delete({ where: { id: N.userId } });

    expect(
      await prisma.glossary.count({ where: { clientId: GN, teamId: T } }),
    ).toBe(1);
    expect(
      await prisma.translationContext.count({
        where: { clientId: CN, teamId: T },
      }),
    ).toBe(1);
  });

  async function createTeam(as: Identity, name: string): Promise<string> {
    const res = await call(as, 'post', '/teams').send({ name }).expect(201);
    return successBody(res, teamResponseSchema).data.team.id;
  }

  function call(
    as: Identity,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ): request.Test {
    return request(app.getHttpServer())
      [method](path)
      .set('authorization', as.bearer);
  }

  function who(label: string): Promise<Identity> {
    return registerAndLogin(app, {
      email: `${label}-${run}@team-libraries-db-e2e.example.com`,
    });
  }
});

function glossaryOf(res: Response) {
  return successBody(res, z.object({ glossary: glossarySchema })).data.glossary;
}

function glossaryIn(res: Response, id: string) {
  const found = successBody(
    res,
    glossaryListResponseSchema,
  ).data.glossaries.find((g) => g.id === id);
  if (!found) throw new Error(`the list did not carry ${id}`);
  return found;
}

function contextOf(res: Response) {
  return successBody(res, z.object({ context: translationContextSchema })).data
    .context;
}

function availableOf(res: Response) {
  return successBody(res, availableTranslationContextsResponseSchema).data;
}
