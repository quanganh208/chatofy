import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshAccessToken } from './refresh-access-token';

const answering = (status: number, body?: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response);

describe('refreshAccessToken', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns the renewed pair with expiresAt in epoch SECONDS', () => {
    answering(200, {
      data: {
        accessToken: 'new.access',
        refreshToken: 'new.refresh',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    });

    // Seconds, not milliseconds. Mixing the units makes a session look either
    // permanently fresh or permanently expired, and both failures are silent.
    return expect(refreshAccessToken('presented')).resolves.toEqual({
      status: 'ok',
      accessToken: 'new.access',
      refreshToken: 'new.refresh',
      expiresAt: Date.parse('2026-01-01T00:00:00.000Z') / 1000,
    });
  });

  describe('ONLY HTTP 401 is terminal', () => {
    // The single most consequential rule in this file. Every status below that
    // was read as terminal would sign out the entire user base over an
    // infrastructure event they cannot do anything about — and they could not
    // sign back in, because login needs the same infrastructure.

    it('reports expired for 401, and only for 401', async () => {
      answering(401, {});
      await expect(refreshAccessToken('presented')).resolves.toEqual({
        status: 'expired',
      });
    });

    it.each([
      [503, 'the token store is unreachable — the API answers 503 for exactly this'],
      [500, 'an unexpected server fault'],
      [502, 'a gateway between here and the API'],
      [429, 'a shared NAT exhausting the per-IP throttle'],
      [404, 'a web build that reached an API without the route yet, mid-deploy'],
      [400, 'a malformed request — still not proof the session is dead'],
    ])('reports transient for %i (%s)', async (status) => {
      answering(status, {});
      await expect(refreshAccessToken('presented')).resolves.toEqual({
        status: 'transient',
      });
    });

    it('reports transient when the API cannot be reached at all', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
      await expect(refreshAccessToken('presented')).resolves.toEqual({
        status: 'transient',
      });
    });

    it('reports transient for a 200 that carries no usable pair', async () => {
      // A malformed deploy must not be able to log out the user base.
      answering(200, { data: { accessToken: 'only.half' } });
      await expect(refreshAccessToken('presented')).resolves.toEqual({
        status: 'transient',
      });
    });

    it('reports transient for a 200 whose expiresAt is unparseable', async () => {
      answering(200, {
        data: {
          accessToken: 'a',
          refreshToken: 'b',
          expiresAt: 'not a date',
        },
      });
      await expect(refreshAccessToken('presented')).resolves.toEqual({
        status: 'transient',
      });
    });
  });

  it('bounds the request, because it runs inside the jwt callback', async () => {
    const fetchSpy = answering(200, {
      data: { accessToken: 'a', refreshToken: 'b', expiresAt: '2026-01-01T00:00:00.000Z' },
    });
    await refreshAccessToken('presented');

    // Unbounded, this stalls /api/auth/session, so `update()` never resolves and
    // every caller waiting on it hangs too.
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeDefined();
  });
});
