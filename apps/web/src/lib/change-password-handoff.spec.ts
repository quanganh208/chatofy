import { describe, expect, it, vi } from 'vitest';
import { requestPasswordChange } from './change-password-handoff';

const BASE = 'https://api.example.com';
const INPUT = {
  accessToken: 'live.access.token',
  currentPassword: 'old',
  newPassword: 'new-password',
};

const SESSION = {
  user: { id: 'u1', email: 'a@b.co', name: 'A', avatarUrl: null },
  token: {
    accessToken: 'replacement.access',
    refreshToken: 'replacement-refresh',
    expiresAt: '2026-11-01T11:00:00.000Z',
  },
};

function answering(status: number, body: unknown = { success: false }) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('requestPasswordChange', () => {
  it('posts both passwords with the caller’s bearer token, and nothing else', async () => {
    const fetchImpl = answering(200, { success: true, data: SESSION });
    await requestPasswordChange(fetchImpl, BASE, INPUT);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE}/auth/change-password`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe(
      'Bearer live.access.token',
    );
    // The token rides in the header only; the body carries the two passwords.
    expect(JSON.parse(init?.body as string)).toEqual({
      currentPassword: 'old',
      newPassword: 'new-password',
    });
  });

  it('hands back the replacement session on 200', async () => {
    const outcome = await requestPasswordChange(
      answering(200, { success: true, data: SESSION }),
      BASE,
      INPUT,
    );
    expect(outcome).toEqual({ session: SESSION });
  });

  it.each([
    [400, 'invalid'],
    [401, 'session-expired'],
    [403, 'wrong-current'],
    [409, 'no-password'],
    [429, 'rate-limited'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('maps %i to %s', async (status, failure) => {
    await expect(requestPasswordChange(answering(status), BASE, INPUT)).resolves.toEqual({
      failure,
    });
  });

  it('calls only a 401 an expired session', async () => {
    // A wrong password read as a dead session would sign out the person fixing a typo.
    for (const status of [400, 403, 404, 409, 422, 429, 500]) {
      const outcome = await requestPasswordChange(answering(status), BASE, INPUT);
      expect(outcome).not.toEqual({ failure: 'session-expired' });
    }
  });

  it('treats an unreachable API as a fault, not a refusal', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    await expect(requestPasswordChange(fetchImpl, BASE, INPUT)).resolves.toEqual({
      failure: 'server',
    });
  });

  it('treats a 200 without a refresh token as a fault', async () => {
    const token = { ...SESSION.token, refreshToken: undefined };
    const outcome = await requestPasswordChange(
      answering(200, { success: true, data: { ...SESSION, token } }),
      BASE,
      INPUT,
    );
    expect(outcome).toEqual({ failure: 'server' });
  });
});
