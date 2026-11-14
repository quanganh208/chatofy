import { describe, expect, it } from 'vitest';
import { hashInviteToken, mintInviteToken } from './team-invite-token';

describe('invite tokens', () => {
  it('mints a 43-character base64url token', () => {
    expect(mintInviteToken().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores a 64-character sha256 hex of the token', () => {
    const { token, tokenHash } = mintInviteToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashInviteToken(token));
  });

  it('hashes the same input to the same value', () => {
    expect(hashInviteToken('a'.repeat(43))).toBe(
      hashInviteToken('a'.repeat(43)),
    );
  });

  it('never mints the same token twice', () => {
    expect(mintInviteToken().token).not.toBe(mintInviteToken().token);
  });
});
