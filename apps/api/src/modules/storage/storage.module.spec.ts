import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { getR2Config } from './storage.module';

function fakeConfig(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

const FULL_R2: Partial<Env> = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'chatofy-avatars',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
};

describe('getR2Config', () => {
  it('returns the client configuration when every value is present', () => {
    expect(getR2Config(fakeConfig(FULL_R2))).toEqual({
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'chatofy-avatars',
    });
  });

  it('returns undefined when nothing is configured at all', () => {
    // The dev and test default. The API still boots; the endpoints refuse.
    expect(getR2Config(fakeConfig({}))).toBeUndefined();
  });

  it.each(Object.keys(FULL_R2) as Array<keyof Env>)(
    'returns undefined when only %s is missing',
    (missing) => {
      // All-or-nothing by construction. A half-configured set must not produce a
      // client that can store bytes nobody can fetch — which is exactly what a
      // present credential set with no public base would be.
      const partial = { ...FULL_R2 };
      delete partial[missing];
      expect(getR2Config(fakeConfig(partial))).toBeUndefined();
    },
  );
});
