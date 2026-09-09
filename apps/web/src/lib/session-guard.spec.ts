import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import { isLiveSession } from './session-guard';

const sessionWith = (over: Partial<Session> = {}): Session => ({
  expires: '2099-01-01T00:00:00.000Z',
  accessToken: 'a.token',
  ...over,
});

describe('isLiveSession', () => {
  it('accepts a session with no error', () => {
    expect(isLiveSession(sessionWith())).toBe(true);
  });

  it('refuses a session whose renewal terminally failed', () => {
    expect(isLiveSession(sessionWith({ error: 'RefreshTokenError' }))).toBe(false);
  });

  it('refuses a session that is not there at all', () => {
    expect(isLiveSession(null)).toBe(false);
    expect(isLiveSession(undefined)).toBe(false);
  });

  it('refuses an errored session even while it still carries a token', () => {
    // THE LOOP CASE. The route guard sends this to /login; the reverse guard on
    // /login must agree it is dead, or it redirects straight back to a gated
    // route and the two bounce forever. A guard reading `accessToken` presence
    // instead of the error would ship exactly that.
    expect(
      isLiveSession(sessionWith({ accessToken: 'still.here', error: 'RefreshTokenError' })),
    ).toBe(false);
  });

  it('accepts a session whose access token has expired but is renewable', () => {
    // A Server Component legitimately reads one of these: RSC renders cannot
    // write a cookie, so they never rotate. Consulting expiry here would render
    // a live user signed out on every public page.
    expect(isLiveSession(sessionWith({ accessToken: undefined }))).toBe(true);
  });
});
