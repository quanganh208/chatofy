import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { ConfigService } from '@nestjs/config';
import { GoogleTokenVerifier } from './google-token-verifier';
import type { Env } from '../../config/env.schema';

function verifierWith(clientIds: string | undefined, mobileIds?: string) {
  const values: Record<string, string | undefined> = {
    AUTH_GOOGLE_ID: clientIds,
    AUTH_GOOGLE_MOBILE_IDS: mobileIds,
  };
  const config = {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService<Env, true>;
  return new GoogleTokenVerifier(config);
}

/** Stand in for a Google reply that succeeds. */
function mockGoogle(payload: unknown) {
  return vi
    .spyOn(OAuth2Client.prototype, 'verifyIdToken')
    .mockResolvedValue({ getPayload: () => payload } as never);
}

/**
 * Google refusing the token. Thrown synchronously rather than returned as a
 * rejected promise: the verifier awaits inside a try/catch, so both arrive the
 * same way, and this one needs no cast to satisfy the mock's return type.
 */
function mockGoogleRefuses() {
  return vi
    .spyOn(OAuth2Client.prototype, 'verifyIdToken')
    .mockImplementation((): never => {
      throw new Error('invalid signature');
    });
}

const VALID = {
  sub: 'google-sub-1',
  email: 'person@example.com',
  email_verified: true,
  name: 'A Person',
};

describe('GoogleTokenVerifier', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the identity for a token Google accepts', async () => {
    mockGoogle(VALID);
    await expect(verifierWith('client-a').verify('id.token')).resolves.toEqual({
      sub: 'google-sub-1',
      email: 'person@example.com',
      emailVerified: true,
      name: 'A Person',
    });
  });

  it('accepts exactly the web client id as the audience', async () => {
    const spy = mockGoogle(VALID);
    await verifierWith(' web-client-id ').verify('id.token');
    expect(spy).toHaveBeenCalledWith({
      idToken: 'id.token',
      audience: ['web-client-id'],
    });
  });

  it('accepts the web id and each named mobile id, and nothing else', async () => {
    const spy = mockGoogle(VALID);
    await verifierWith('web-id', ' ios-id, android-id ,, web-id ').verify(
      'id.token',
    );
    expect(spy).toHaveBeenCalledWith({
      idToken: 'id.token',
      audience: ['web-id', 'ios-id', 'android-id'],
    });
  });

  it('works with mobile ids alone', async () => {
    const spy = mockGoogle(VALID);
    await verifierWith(undefined, 'ios-id').verify('id.token');
    expect(spy).toHaveBeenCalledWith({
      idToken: 'id.token',
      audience: ['ios-id'],
    });
  });

  it('refuses a token Google rejects — tampered, expired or wrong audience alike', async () => {
    mockGoogleRefuses();
    await expect(
      verifierWith('client-a').verify('bad.token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a verified token carrying no subject', async () => {
    mockGoogle({ email: 'person@example.com', email_verified: true });
    await expect(
      verifierWith('client-a').verify('id.token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reads a missing or non-boolean email_verified as NOT verified', async () => {
    // The linking policy turns on this flag, so anything that is not exactly
    // `true` has to fall on the safe side.
    mockGoogle({ ...VALID, email_verified: 'true' });
    await expect(
      verifierWith('client-a').verify('id.token'),
    ).resolves.toMatchObject({ emailVerified: false });

    mockGoogle({ sub: 's', email: 'e@x.com' });
    await expect(
      verifierWith('client-a').verify('id.token'),
    ).resolves.toMatchObject({ emailVerified: false });
  });

  it('says Google login is unconfigured, in a message that survives the error filter', async () => {
    await expect(
      verifierWith(undefined).verify('id.token'),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(verifierWith('   ').verify('id.token')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(
      verifierWith(undefined, ' , ').verify('id.token'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});
