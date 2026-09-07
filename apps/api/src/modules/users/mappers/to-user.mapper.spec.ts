import { describe, expect, it } from 'vitest';
import { userSchema } from '@chatofy/types';
import type { UserRecord } from '../interfaces/user-repository.interface';
import { toUserContract } from './to-user.mapper';

/**
 * The mapper is a pure function and the only place a stored avatar KEY becomes a
 * public URL. There is no write path yet, so the composition rule — and in
 * particular the two ways it must produce null — is provable only here.
 */
describe('toUserContract', () => {
  const record = (over: Partial<UserRecord> = {}): UserRecord => ({
    id: 'user_1',
    email: 'a@b.com',
    locale: 'en',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  });

  const BASE = 'https://cdn.example.com';
  const KEY = 'avatars/user_1/abc-def.webp';

  it('composes the URL from the base and the key', () => {
    expect(toUserContract(record({ avatarKey: KEY }), BASE).avatarUrl).toBe(
      `${BASE}/${KEY}`,
    );
  });

  it('does not double the separator when the base ends in a slash', () => {
    expect(
      toUserContract(record({ avatarKey: KEY }), `${BASE}/`).avatarUrl,
    ).toBe(`${BASE}/${KEY}`);
  });

  it('is null when the row has a key but no origin is configured', () => {
    // The state the web surface is warned about: a key exists, so the row DOES
    // have an avatar, yet no URL could load. Emitting one would publish a link
    // the browser cannot resolve.
    expect(toUserContract(record({ avatarKey: KEY })).avatarUrl).toBeNull();
  });

  it('is null when an origin is configured but the row has no key', () => {
    expect(toUserContract(record(), BASE).avatarUrl).toBeNull();
  });

  it('parses a payload that predates the field, defaulting it to null', () => {
    // The compatibility direction `.default(null)` exists for: an OLDER api's
    // response reaching a NEWER client. A required key would make `apiFetch`
    // throw a ContractError and fail the whole request over one decorative
    // field, so the absence has to parse.
    const legacy = {
      id: 'user_1',
      email: 'a@b.com',
      name: null,
      locale: 'en',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const parsed = userSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.avatarUrl).toBeNull();
  });

  it('carries no internal column into the contract', () => {
    // Fields are listed explicitly rather than spread, so a column added to the
    // record cannot reach a response by accident.
    const contract = toUserContract(
      record({ avatarKey: KEY, avatarChangedAt: new Date() }),
      BASE,
    );
    expect(Object.keys(contract).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'locale',
      'name',
    ]);
  });
});
