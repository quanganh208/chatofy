import { describe, expect, it, vi } from 'vitest';
import { REFRESH_SKEW_SECONDS, applyRenewal, type RenewableToken } from './session-renewal';
import type { RefreshOutcome } from './refresh-access-token';

const EXPIRES_AT = 1_800_000_000;

/** A live token: renewable, not yet terminal. */
const liveToken = (): RenewableToken => ({
  accessToken: 'old.access',
  refreshToken: 'old.refresh',
  expiresAt: EXPIRES_AT,
  picture: 'https://cdn/old.png',
});

const deps = (
  refresh: RefreshOutcome | Error = { status: 'transient' },
  avatar: string | null | undefined = undefined,
) => ({
  refresh: vi.fn(() =>
    refresh instanceof Error ? Promise.reject(refresh) : Promise.resolve(refresh),
  ),
  fetchAvatar: vi.fn(() => Promise.resolve(avatar)),
});

const renewedPair: RefreshOutcome = {
  status: 'ok',
  accessToken: 'new.access',
  refreshToken: 'new.refresh',
  expiresAt: EXPIRES_AT + 900,
};

/** Comfortably inside the token's life, so nothing is due on the clock alone. */
const fresh = EXPIRES_AT - REFRESH_SKEW_SECONDS - 1;

describe('applyRenewal', () => {
  describe('only where a cookie can be written', () => {
    it('rotates nothing on a path that cannot persist the successor', async () => {
      const d = deps(renewedPair);
      const token = { ...liveToken(), expiresAt: EXPIRES_AT };

      const result = await applyRenewal(
        token,
        {
          canPersist: false,
          // Due on the clock, and forced — neither may override the write gate,
          // because a successor minted here is discarded and the browser's next
          // use of the spent token reads as theft.
          trigger: 'update',
          nowSeconds: EXPIRES_AT,
        },
        d,
      );

      expect(d.refresh).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('old.access');
      expect(result.error).toBeUndefined();
    });
  });

  describe('a cookie predating the feature is terminal', () => {
    it('flags a token with no expiresAt', async () => {
      const d = deps(renewedPair);
      // Annotated rather than asserted: the generic would otherwise narrow the
      // return to this literal's own shape, and `error` — the field under test —
      // would not exist on it.
      const preFeature: RenewableToken = { accessToken: 'a', refreshToken: 'r' };

      const result = await applyRenewal(preFeature, { canPersist: true, nowSeconds: fresh }, d);

      expect(result.error).toBe('RefreshTokenError');
      expect(d.refresh).not.toHaveBeenCalled();
    });

    it('flags a token with an expiresAt but no refreshToken', async () => {
      // The deploy-ordering case: an API that predates this feature answers
      // login with an expiresAt and no refresh token, so every session lands
      // here on its first writable call and nobody can enter the app.
      const d = deps(renewedPair);
      const oldApiSession: RenewableToken = { accessToken: 'a', expiresAt: EXPIRES_AT };

      const result = await applyRenewal(oldApiSession, { canPersist: true, nowSeconds: fresh }, d);

      expect(result.error).toBe('RefreshTokenError');
      expect(d.refresh).not.toHaveBeenCalled();
    });

    it('does not re-present a token already refused', async () => {
      const d = deps(renewedPair);

      await applyRenewal(
        { ...liveToken(), error: 'RefreshTokenError' },
        { canPersist: true, nowSeconds: EXPIRES_AT },
        d,
      );

      expect(d.refresh).not.toHaveBeenCalled();
    });
  });

  describe('the skew boundary', () => {
    it('does not renew one second before the window opens', async () => {
      const d = deps(renewedPair);

      await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          nowSeconds: EXPIRES_AT - REFRESH_SKEW_SECONDS - 1,
        },
        d,
      );

      expect(d.refresh).not.toHaveBeenCalled();
    });

    it('renews exactly at the boundary', async () => {
      const d = deps(renewedPair);

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          nowSeconds: EXPIRES_AT - REFRESH_SKEW_SECONDS,
        },
        d,
      );

      expect(d.refresh).toHaveBeenCalledWith('old.refresh');
      expect(result.accessToken).toBe('new.access');
      expect(result.refreshToken).toBe('new.refresh');
      expect(result.expiresAt).toBe(EXPIRES_AT + 900);
    });
  });

  describe('a forced renewal ignores the clock', () => {
    // A 401 is positive evidence the access token is dead whatever expiresAt
    // says. Without this, a password change on another device leaves the user
    // "signed in" on an app where every request 401s until the skew window
    // opens on its own.
    it('renews on the update trigger even when the token looks fresh', async () => {
      const d = deps(renewedPair);

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(d.refresh).toHaveBeenCalledWith('old.refresh');
      expect(result.accessToken).toBe('new.access');
    });

    it('signs out when the forced renewal is terminally refused', async () => {
      const d = deps({ status: 'expired' });

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(result.error).toBe('RefreshTokenError');
      expect(result.refreshToken).toBeUndefined();
    });
  });

  describe('only a 401 is terminal', () => {
    it('leaves the session untouched on a transient failure', async () => {
      const d = deps({ status: 'transient' });

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          nowSeconds: EXPIRES_AT,
        },
        d,
      );

      // No error set, and the pair is left as it was: an outage is not evidence
      // about the session, and treating it as evidence is a mass logout.
      expect(result.error).toBeUndefined();
      expect(result.accessToken).toBe('old.access');
      expect(result.refreshToken).toBe('old.refresh');
    });

    it('clears a stale error once a renewal succeeds', async () => {
      const d = deps(renewedPair);

      const result = await applyRenewal(
        { ...liveToken(), error: undefined },
        { canPersist: true, nowSeconds: EXPIRES_AT },
        d,
      );

      expect(result.error).toBeUndefined();
    });
  });

  describe('the avatar re-read', () => {
    // It runs on the update trigger, which is the whole point of the trigger
    // for the account page. Gating it behind the skew check meant it fired only
    // in the last minutes of a token's life, so a changed avatar left the
    // sidebar stale until the next sign-in.
    it('re-reads on the update trigger even when nothing was due', async () => {
      const d = deps(renewedPair, 'https://cdn/new.png');

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(result.picture).toBe('https://cdn/new.png');
    });

    it('re-reads with the successor when the same call also renewed', async () => {
      const d = deps(renewedPair, null);

      await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: EXPIRES_AT,
        },
        d,
      );

      // The renewal runs first, so the read never uses a token this call was
      // about to replace.
      expect(d.fetchAvatar).toHaveBeenCalledWith('new.access');
    });

    it('keeps the existing picture when the read itself failed', async () => {
      const d = deps(renewedPair, undefined);

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(result.picture).toBe('https://cdn/old.png');
    });

    it('clears the picture on a clean read that returns none', async () => {
      const d = deps(renewedPair, null);

      const result = await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(result.picture).toBeNull();
    });

    it('does not read on an ordinary navigation', async () => {
      const d = deps(renewedPair, 'https://cdn/new.png');

      await applyRenewal(liveToken(), { canPersist: true, nowSeconds: EXPIRES_AT }, d);

      expect(d.fetchAvatar).not.toHaveBeenCalled();
    });

    it('does not spend a read on a token the renewal just killed', async () => {
      const d = deps({ status: 'expired' }, 'https://cdn/new.png');

      await applyRenewal(
        liveToken(),
        {
          canPersist: true,
          trigger: 'update',
          nowSeconds: fresh,
        },
        d,
      );

      expect(d.fetchAvatar).not.toHaveBeenCalled();
    });
  });
});
