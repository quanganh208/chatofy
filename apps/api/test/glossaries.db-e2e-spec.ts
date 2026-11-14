import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Glossary terms against a REAL Postgres.
//
// A term row has two ids: the `id` primary key Postgres mints as a cuid, and the
// `clientId` UUID the browser sends for idempotent retries. The shared contract
// types a term's `id` as a UUID, so the API must hand out `clientId` and look a
// term up by it. When the store handed out the cuid instead, every term list
// failed the client's parse and every delete answered 400 — and an in-memory
// double that mints UUIDs for both could never have shown it, because only the
// real `@default(cuid())` makes the two ids differ.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  glossaryItemListResponseSchema,
  glossaryItemSchema,
  type SaveGlossaryItemRequest,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
/** What POST /glossaries/:id/items answers inside the envelope. */
const addedItemSchema = z.object({ item: glossaryItemSchema });

const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Glossary terms (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: Identity;

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
      email: `alice-${run}@glossary-db-e2e.example.com`,
    });
  });

  afterAll(async () => {
    // `Glossary.ownerId` is a plain column with no relation to `User`, so the
    // glossaries are deleted by owner id; GlossaryItem cascades from them.
    await prisma.glossary.deleteMany({ where: { ownerId: alice.userId } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    // Every case calls from one address; reset the per-address budget so the
    // suite never asserts rate limiting by accident.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  it('lists a stored term under the id the client minted, and deletes it by that id', async () => {
    const glossaryId = randomUUID();
    await request(app.getHttpServer())
      .put(`/glossaries/${glossaryId}`)
      .set('authorization', alice.bearer)
      .send({ name: 'Cardiology', description: null, sourceLang: 'vi' })
      .expect(200);

    const clientId = randomUUID();
    const added = await addItem(glossaryId, item({ clientId })).expect(201);
    expect(successBody(added, addedItemSchema).data.item.id).toBe(clientId);

    // The row's own key really is a cuid — otherwise this case would pass on a
    // schema that no longer has the two ids it exists to tell apart.
    const row = await prisma.glossaryItem.findFirstOrThrow({
      where: { clientId },
    });
    expect(row.id).not.toBe(clientId);

    const listed = await listItems(glossaryId).expect(200);
    // `successBody` runs the same zod parse the web client does, which is the
    // parse that rejected every real term list.
    const { items } = successBody(listed, glossaryItemListResponseSchema).data;
    expect(items.map((term) => term.id)).toEqual([clientId]);

    await request(app.getHttpServer())
      .delete(`/glossaries/${glossaryId}/items/${clientId}`)
      .set('authorization', alice.bearer)
      .expect(204);

    // The delete answers 204 whether a row went or not, so only a row count can
    // say the term is really gone.
    expect(await prisma.glossaryItem.count({ where: { clientId } })).toBe(0);
  });

  it('answers a retry with the same clientId with the same term', async () => {
    const glossaryId = randomUUID();
    await request(app.getHttpServer())
      .put(`/glossaries/${glossaryId}`)
      .set('authorization', alice.bearer)
      .send({ name: 'Retries', description: null, sourceLang: 'vi' })
      .expect(200);

    const body = item({ clientId: randomUUID() });
    const first = successBody(await addItem(glossaryId, body), addedItemSchema);
    const second = successBody(
      await addItem(glossaryId, body),
      addedItemSchema,
    );

    expect(second.data.item.id).toBe(first.data.item.id);
    expect(
      await prisma.glossaryItem.count({ where: { clientId: body.clientId } }),
    ).toBe(1);
  });

  function addItem(glossaryId: string, payload: SaveGlossaryItemRequest) {
    return request(app.getHttpServer())
      .post(`/glossaries/${glossaryId}/items`)
      .set('authorization', alice.bearer)
      .send(payload);
  }

  function listItems(glossaryId: string) {
    return request(app.getHttpServer())
      .get(`/glossaries/${glossaryId}/items`)
      .set('authorization', alice.bearer);
  }
});

function item(
  overrides: Partial<SaveGlossaryItemRequest> = {},
): SaveGlossaryItemRequest {
  return {
    clientId: randomUUID(),
    original: 'điện tâm đồ',
    translation: 'ECG',
    targetLang: 'en',
    notes: null,
    ...overrides,
  };
}
