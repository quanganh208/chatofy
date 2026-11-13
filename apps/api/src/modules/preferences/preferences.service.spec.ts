import { describe, expect, it } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  PREFERENCES_LIMITS,
  defaultUserPreferences,
  type UserPreferences,
} from '@chatofy/types';
import { PreferencesService } from './preferences.service';
import type {
  StoredPreferences,
  UserPreferencesStore,
} from './interfaces/user-preferences-store.interface';

/**
 * The service over an in-memory store holding rows for two accounts.
 *
 * The double applies `next` the way the real store does — current state in, the
 * returned document written, a throw writing nothing — so what these cases prove
 * is the service's half: tolerant reads, merge-then-validate writes, and the
 * defaults. Whether two concurrent writes really serialise is the db-e2e
 * suite's claim; a `Map` cannot make one call wait for another.
 */

const MINE = 'user-1';
const OTHER = 'user-2';
const STAMP = new Date('2026-11-13T00:00:00.000Z');
const RESET_STAMP = new Date('2026-11-13T00:00:01.000Z');

function fakeStore(
  users: Record<string, { locale: string; data?: unknown }> = {
    [MINE]: { locale: 'vi' },
    [OTHER]: { locale: 'en' },
  },
) {
  const rows = new Map<string, { data: unknown; updatedAt: Date }>();
  for (const [id, user] of Object.entries(users)) {
    if (user.data !== undefined)
      rows.set(id, { data: user.data, updatedAt: STAMP });
  }
  const current = (id: string): StoredPreferences | null => {
    const user = users[id];
    if (!user) return null;
    const row = rows.get(id);
    return {
      locale: user.locale,
      data: row?.data ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  };

  const store: UserPreferencesStore = {
    async read(id) {
      return current(id);
    },
    async update(id, next) {
      const now = current(id);
      if (!now) return null;
      // Through JSON, as JSONB would: the stored value is a copy, not a
      // reference the service could mutate after the fact.
      const data: unknown = JSON.parse(JSON.stringify(next(now)));
      rows.set(id, { data, updatedAt: STAMP });
      return current(id);
    },
    async reset(id) {
      if (!users[id]) return null;
      rows.set(id, { data: {}, updatedAt: RESET_STAMP });
      return current(id);
    },
  };
  return { store, rows };
}

const service = (store: UserPreferencesStore) => new PreferencesService(store);

describe('PreferencesService', () => {
  it("answers an account with no row with its locale's defaults and a null updatedAt", async () => {
    const { store } = fakeStore();

    const result = await service(store).get(MINE);

    expect(result).toEqual({
      preferences: defaultUserPreferences('vi'),
      updatedAt: null,
    });
    // The smart default: translations go INTO the account's own language.
    expect(result.preferences.pairs.webOneWay.target).toBe('vi');
  });

  it('reads a stored document field by field, so one unreadable field costs only itself', async () => {
    const { store } = fakeStore({
      [MINE]: {
        locale: 'en',
        data: { theme: 'dark', translateMode: 'sideways' },
      },
    });

    const { preferences, updatedAt } = await service(store).get(MINE);

    expect(preferences.theme).toBe('dark');
    expect(preferences.translateMode).toBe(
      defaultUserPreferences('en').translateMode,
    );
    expect(updatedAt).toBe(STAMP.toISOString());
  });

  it('merges a patch over what is stored and keeps every field it did not name', async () => {
    const { store, rows } = fakeStore({
      [MINE]: {
        locale: 'vi',
        data: {
          ...defaultUserPreferences('vi'),
          theme: 'dark',
          voices: { en: { speak: true, speed: 1.25 } },
        },
      },
    });

    const result = await service(store).update(MINE, {
      voices: { en: { voice: 'af_heart' } },
      call: { captions: false },
    });

    expect(result.preferences.theme).toBe('dark');
    expect(result.preferences.voices.en).toEqual({
      speak: true,
      speed: 1.25,
      voice: 'af_heart',
    });
    expect(result.preferences.call).toEqual({
      ...defaultUserPreferences('vi').call,
      captions: false,
    });
    expect((rows.get(MINE)?.data as UserPreferences).call.captions).toBe(false);
  });

  it('merges the first patch over the defaults when no row exists yet', async () => {
    const { store } = fakeStore();

    const result = await service(store).update(MINE, { theme: 'light' });

    expect(result.preferences).toEqual({
      ...defaultUserPreferences('vi'),
      theme: 'light',
    });
    expect(result.updatedAt).toBe(STAMP.toISOString());
  });

  it('clears a voice token with voice: null, so the stored entry holds no voice key', async () => {
    const { store, rows } = fakeStore();
    const prefs = service(store);

    await prefs.update(MINE, { voices: { en: { voice: 'x', speed: 1.5 } } });
    const result = await prefs.update(MINE, {
      voices: { en: { voice: null } },
    });

    expect(result.preferences.voices.en).toEqual({ speed: 1.5 });
    const stored = (rows.get(MINE)?.data as UserPreferences).voices.en;
    expect(stored).toEqual({ speed: 1.5 });
    expect(stored).not.toHaveProperty('voice');
  });

  it('sets a nullable field to null when the patch says null', async () => {
    const { store } = fakeStore({
      [MINE]: {
        locale: 'en',
        data: { ...defaultUserPreferences('en'), contextId: 'ctx-1' },
      },
    });

    const result = await service(store).update(MINE, { contextId: null });

    expect(result.preferences.contextId).toBeNull();
  });

  it('refuses with 400 and writes nothing when the merged document passes the byte cap', async () => {
    // `reading` is the one open object, so it is how a document grows: a patch
    // small enough on its own still breaches the cap once merged over what the
    // account already holds.
    const half = 'x'.repeat(PREFERENCES_LIMITS.MAX_DOCUMENT_BYTES / 2);
    const stored = { ...defaultUserPreferences('en'), reading: { a: half } };
    const { store, rows } = fakeStore({
      [MINE]: { locale: 'en', data: stored },
    });

    await expect(
      service(store).update(MINE, { reading: { b: half } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.get(MINE)?.data).toEqual(stored);
  });

  it("never touches another account's row", async () => {
    const { store, rows } = fakeStore();

    await service(store).update(MINE, { theme: 'dark' });

    expect(rows.has(OTHER)).toBe(false);
  });

  it('reset empties the row, answers with the defaults, and moves updatedAt forward', async () => {
    const { store, rows } = fakeStore({
      [MINE]: {
        locale: 'en',
        data: { ...defaultUserPreferences('en'), theme: 'dark' },
      },
    });

    const result = await service(store).reset(MINE);

    expect(result).toEqual({
      preferences: defaultUserPreferences('en'),
      updatedAt: RESET_STAMP.toISOString(),
    });
    expect(rows.get(MINE)?.data).toEqual({});
  });

  it('answers 401 on every route when the account behind the token is gone', async () => {
    const { store } = fakeStore({});
    const prefs = service(store);

    await expect(prefs.get(MINE)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(prefs.update(MINE, { theme: 'dark' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(prefs.reset(MINE)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
