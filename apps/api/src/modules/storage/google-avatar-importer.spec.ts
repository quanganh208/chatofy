import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger } from '@nestjs/common';
import { MAX_AVATAR_BYTES } from './avatar-image';
import {
  fetchGoogleAvatar,
  isGooglePictureUrl,
  withSize,
} from './google-avatar-importer';

const logger = { warn: vi.fn() } as unknown as Logger;

/** A Response whose body streams the given bytes in one chunk. */
function bodyOf(bytes: Buffer, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, ...init });
}

describe('isGooglePictureUrl', () => {
  it('accepts a real Google picture host', () => {
    expect(isGooglePictureUrl('https://lh3.googleusercontent.com/a/xyz')).toBe(
      true,
    );
    expect(isGooglePictureUrl('https://googleusercontent.com/a/xyz')).toBe(
      true,
    );
  });

  it('refuses a lookalike host a suffix match would accept', () => {
    // `endsWith('googleusercontent.com')` says yes to this. Parsing says no.
    expect(isGooglePictureUrl('https://evilgoogleusercontent.com/a/xyz')).toBe(
      false,
    );
  });

  it('refuses a userinfo prefix, where the real host is the attacker', () => {
    expect(
      isGooglePictureUrl('https://lh3.googleusercontent.com@attacker.tld/a'),
    ).toBe(false);
  });

  it('refuses http', () => {
    expect(isGooglePictureUrl('http://lh3.googleusercontent.com/a')).toBe(
      false,
    );
  });

  it('refuses something that is not a URL at all', () => {
    expect(isGooglePictureUrl('not a url')).toBe(false);
  });
});

describe('withSize', () => {
  it('asks for a 256px square when no size is present', () => {
    expect(withSize('https://lh3.googleusercontent.com/a/xyz')).toBe(
      'https://lh3.googleusercontent.com/a/xyz=s256-c',
    );
  });

  it('replaces an existing size suffix rather than appending to it', () => {
    expect(withSize('https://lh3.googleusercontent.com/a/xyz=s96-c')).toBe(
      'https://lh3.googleusercontent.com/a/xyz=s256-c',
    );
  });

  it('leaves a query string intact instead of truncating at its first =', () => {
    // Google serves the size as a path suffix, so this is not reachable today —
    // but the transform must not silently mangle a URL that carries a query.
    expect(withSize('https://lh3.googleusercontent.com/a/xyz?v=2')).toBe(
      'https://lh3.googleusercontent.com/a/xyz=s256-c?v=2',
    );
  });
});

describe('fetchGoogleAvatar', () => {
  const ALLOWED = 'https://lh3.googleusercontent.com/a/xyz';
  let fetchMock: MockInstance;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('fetches an allowed host, asking for the size it wants', async () => {
    fetchMock.mockResolvedValue(bodyOf(Buffer.from('bytes')));
    const bytes = await fetchGoogleAvatar(ALLOWED, logger);

    expect(bytes?.toString()).toBe('bytes');
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ALLOWED}=s256-c`);
  });

  it('never follows a redirect, so a 30x cannot bypass the allowlist', async () => {
    // The bytes land in a PUBLIC bucket and this process can reach the local
    // sidecars, so a followed redirect is a read-SSRF exfiltration primitive.
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://localhost:8002/secrets' },
      }),
    );
    await expect(fetchGoogleAvatar(ALLOWED, logger)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it.each([
    ['a lookalike host', 'https://evilgoogleusercontent.com/a/xyz'],
    ['a userinfo prefix', 'https://lh3.googleusercontent.com@attacker.tld/a'],
    ['an http URL', 'http://lh3.googleusercontent.com/a/xyz'],
    ['a local address', 'https://localhost:8002/a'],
  ])('refuses %s without making a request', async (_label, url) => {
    await expect(fetchGoogleAvatar(url, logger)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a body over the cap rather than buffering all of it', async () => {
    // Content-Length is a claim; the running count is what actually bounds this.
    fetchMock.mockResolvedValue(bodyOf(Buffer.alloc(MAX_AVATAR_BYTES + 1)));
    await expect(fetchGoogleAvatar(ALLOWED, logger)).resolves.toBeNull();
  });

  it('returns null when the request rejects, e.g. on timeout', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), {
        name: 'TimeoutError',
      }),
    );
    await expect(fetchGoogleAvatar(ALLOWED, logger)).resolves.toBeNull();
  });

  it('returns null for a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(fetchGoogleAvatar(ALLOWED, logger)).resolves.toBeNull();
  });
});
