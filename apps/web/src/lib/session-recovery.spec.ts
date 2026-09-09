import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { isLiveSession } from './session-guard';

const signOut = vi.fn<(options: { redirectTo: string }) => Promise<void>>();
vi.mock('next-auth/react', () => ({
  signOut: (options: { redirectTo: string }) => signOut(options),
}));

const { recoverFromUnauthorized } = await import('./session-recovery');

const sessionWith = (over: Partial<Session>): Session => ({
  expires: '2099-01-01T00:00:00.000Z',
  ...over,
});

describe('recoverFromUnauthorized', () => {
  beforeEach(() => signOut.mockReset());

  it('reports refreshed when the renewal produced a DIFFERENT token', async () => {
    const outcome = await recoverFromUnauthorized(
      () => Promise.resolve(sessionWith({ accessToken: 'renewed' })),
      'expired',
    );

    expect(outcome).toBe('refreshed');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('reports transient when the token came back UNCHANGED', async () => {
    // The assertion that stops the loop this whole change exists to remove.
    // Reporting `refreshed` on every truthy token means reporting success on a
    // 429, a 5xx and a timeout alike — and the caller then retries with the
    // identical expired token and 401s again, forever, while the user sits
    // "signed in" on an app where nothing works.
    const outcome = await recoverFromUnauthorized(
      () => Promise.resolve(sessionWith({ accessToken: 'expired' })),
      'expired',
    );

    expect(outcome).toBe('transient');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when the session carries the terminal error', async () => {
    // After the two cases below, this is the ONLY thing that signs anybody out
    // from here: the single signal the API and the jwt callback set deliberately
    // once renewal has been refused for good.
    const outcome = await recoverFromUnauthorized(
      () => Promise.resolve(sessionWith({ accessToken: 'stale', error: 'RefreshTokenError' })),
      'stale',
    );

    expect(outcome).toBe('signed-out');
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });

  it('does NOT sign out when the session read came back empty', async () => {
    // `null` is not evidence. next-auth's `fetchData` returns null for ANY
    // failure — a network blip, a non-OK response, an unparseable body — so it
    // conflates "asked, and there is no session" with "could not ask at all".
    // Signing out here lets a blip from the web app's own /api/auth/session log
    // the user out, which is the one thing 401-only-is-terminal forbids.
    expect(await recoverFromUnauthorized(() => Promise.resolve(null), 'stale')).toBe('transient');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does NOT sign out when the session came back without a token', async () => {
    expect(await recoverFromUnauthorized(() => Promise.resolve(sessionWith({})), 'stale')).toBe(
      'transient',
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it('agrees with the guard: an errored session is never signed in', () => {
    // The loop case, asserted from the other side. If recovery signs this
    // session out but `isLiveSession` still called it live, /login would
    // redirect it straight back to a gated route.
    const dead = sessionWith({ accessToken: 'stale', error: 'RefreshTokenError' });
    expect(isLiveSession(dead)).toBe(false);
  });
});
