import { describe, expect, it } from 'vitest';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  ROTATION_GRACE_SECONDS,
  familyKey,
  hashRefreshToken,
  mintRefreshToken,
  tokenKey,
} from './refresh-token-secret';

describe('refresh token secrets', () => {
  it('mints 256 bits of entropy, URL-safe', () => {
    const token = mintRefreshToken();
    // 32 raw bytes -> 43 base64url characters, no padding, nothing that needs
    // escaping in a JSON body or a header.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('does not repeat itself', () => {
    const minted = new Set(Array.from({ length: 200 }, mintRefreshToken));
    expect(minted.size).toBe(200);
  });

  it('hashes to fixed-length hex that does not contain the token', () => {
    const token = mintRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('hashes deterministically, so a presented token finds its own record', () => {
    const token = mintRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(
      hashRefreshToken(mintRefreshToken()),
    );
  });

  it('namespaces the two key kinds apart', () => {
    expect(tokenKey('abc')).toBe('rt:abc');
    expect(familyKey('abc')).toBe('rtfam:abc');
  });

  it('keeps the grace window above the web client abort', () => {
    // The rule, not a preference: the window must exceed the client's 5 s abort
    // plus in-flight skew, so every member of one burst — including one that
    // timed out and re-signed the stale cookie — lands inside it.
    expect(ROTATION_GRACE_SECONDS).toBeGreaterThan(5);
  });

  it('gives a family thirty days', () => {
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
