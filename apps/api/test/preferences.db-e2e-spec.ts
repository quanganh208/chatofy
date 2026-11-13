import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Account preferences against a REAL Postgres.
//
// The specs beside the module prove the merge and the validation over an
// in-memory store. Two claims here belong to Postgres alone:
//
//   - The row round-trips through JSONB and the cascade: what PATCH stored is
//     what the next GET reads, and DELETE really removes the row.
//   - Concurrent PATCHes for one account serialise. A merge is a read followed
//     by a write, so two devices patching different fields at once lose one of
//     them unless the second read waits for the first write — and before the
//     account's first write there is no preferences row to lock at all. Only a
//     real database can make one transaction wait for another, so only this
//     suite can fail that case.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import {
  PREFERENCES_LIMITS,
  apiErrorResponseSchema,
  defaultUserPreferences,
  preferencesResponseSchema,
  type PreferencesResponse,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { readBody, successBody } from './utils/response-body';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Account preferences (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: Identity;
  let bob: Identity;

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
      email: `prefs-alice-${run}@example.com`,
    });
    bob = await registerAndLogin(app, {
      email: `prefs-bob-${run}@example.com`,
    });
  });

  afterAll(async () => {
    // `UserPreferences` cascades from `User`, so deleting the run's users is
    // the whole cleanup — and a leftover row here would say the cascade broke.
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    expect(
      await prisma.userPreferences.count({
        where: { userId: { in: [alice.userId, bob.userId] } },
      }),
    ).toBe(0);
    await app.close();
  });

  beforeEach(() => {
    // Every case calls from one loopback address; reset the per-address budget
    // so a case never asserts rate limiting by accident. The guard stays.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  const server = () => app.getHttpServer();
  const get = (who: Identity) =>
    request(server()).get('/me/preferences').set('Authorization', who.bearer);
  const patch = (who: Identity, preferences: UserPreferencesPatch) =>
    request(server())
      .patch('/me/preferences')
      .set('Authorization', who.bearer)
      .send({ preferences });
  const reset = (who: Identity) =>
    request(server())
      .delete('/me/preferences')
      .set('Authorization', who.bearer);
  const dataOf = (res: Response): PreferencesResponse =>
    successBody(res, preferencesResponseSchema).data;

  it('reads defaults, patches, reads back and resets', async () => {
    const initial = dataOf(await get(alice).expect(200));
    // The fixture's accounts take the column default, `en`.
    expect(initial).toEqual({
      preferences: defaultUserPreferences('en'),
      updatedAt: null,
    });

    const patched = dataOf(
      await patch(alice, {
        theme: 'dark',
        voices: { en: { speed: 1.25 } },
        call: { captions: false },
      }).expect(200),
    );
    expect(patched.preferences.theme).toBe('dark');
    expect(patched.preferences.voices.en).toEqual({ speed: 1.25 });
    expect(patched.preferences.call.captions).toBe(false);
    expect(patched.updatedAt).not.toBeNull();

    const reread = dataOf(await get(alice).expect(200));
    expect(reread).toEqual(patched);

    const cleared = dataOf(await reset(alice).expect(200));
    expect(cleared).toEqual({
      preferences: defaultUserPreferences('en'),
      updatedAt: null,
    });
    expect(
      await prisma.userPreferences.count({ where: { userId: alice.userId } }),
    ).toBe(0);
    expect(dataOf(await get(alice).expect(200)).updatedAt).toBeNull();
  });

  it('clears a voice token with voice: null and stores no voice key', async () => {
    await patch(alice, { voices: { en: { voice: 'x', speed: 1.5 } } }).expect(
      200,
    );
    await patch(alice, { voices: { en: { voice: null } } }).expect(200);

    expect(dataOf(await get(alice).expect(200)).preferences.voices.en).toEqual({
      speed: 1.5,
    });
    // Read from the row itself: a GET parses tolerantly, so only the stored
    // JSON can show the key is really gone rather than read past.
    const row = await prisma.userPreferences.findUniqueOrThrow({
      where: { userId: alice.userId },
    });
    const stored = (row.data as { voices: Record<string, object> }).voices.en;
    expect(stored).toEqual({ speed: 1.5 });
    expect(stored).not.toHaveProperty('voice');

    await reset(alice).expect(200);
  });

  it("keeps each account's document to itself", async () => {
    await patch(bob, { theme: 'light' }).expect(200);
    await patch(alice, { theme: 'dark' }).expect(200);

    expect(dataOf(await get(bob).expect(200)).preferences.theme).toBe('light');
    await reset(alice).expect(200);
    expect(dataOf(await get(bob).expect(200)).preferences.theme).toBe('light');
    await reset(bob).expect(200);
  });

  it('refuses an invalid patch with 400 and stores nothing', async () => {
    const res = await request(server())
      .patch('/me/preferences')
      .set('Authorization', alice.bearer)
      .send({ preferences: { theme: 'sepia' } })
      .expect(400);
    expect(readBody(res, apiErrorResponseSchema).error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await prisma.userPreferences.count({ where: { userId: alice.userId } }),
    ).toBe(0);
  });

  it('refuses a document past the byte cap with 400 and keeps what was stored', async () => {
    const half = 'x'.repeat(PREFERENCES_LIMITS.MAX_DOCUMENT_BYTES / 2);
    await patch(alice, { reading: { a: half } }).expect(200);

    const res = await patch(alice, { reading: { b: half } }).expect(400);
    expect(readBody(res, apiErrorResponseSchema).error.code).toBe(
      'VALIDATION_FAILED',
    );
    const kept = dataOf(await get(alice).expect(200)).preferences.reading;
    expect(Object.keys(kept)).toEqual(['a']);

    await reset(alice).expect(200);
  });

  it('applies concurrent patches of different fields one after the other, losing neither', async () => {
    // Every round starts from NO row, which is the hardest case: there is
    // nothing to lock until the first write commits.
    for (let round = 0; round < 10; round += 1) {
      await reset(alice).expect(200);
      app
        .get<ThrottlerStorageService>(ThrottlerStorage)
        .onApplicationShutdown();

      await Promise.all([
        patch(alice, { theme: 'dark' }).expect(200),
        patch(alice, { translateMode: 'two-way' }).expect(200),
        patch(alice, { call: { captions: false } }).expect(200),
        patch(alice, { conferenceLanguage: 'vi' }).expect(200),
      ]);

      const { preferences } = dataOf(await get(alice).expect(200));
      expect(preferences).toMatchObject({
        theme: 'dark',
        translateMode: 'two-way',
        call: { captions: false },
        conferenceLanguage: 'vi',
      });
    }
    await reset(alice).expect(200);
  });

  it('refuses an anonymous caller', async () => {
    await request(server()).get('/me/preferences').expect(401);
  });
});
