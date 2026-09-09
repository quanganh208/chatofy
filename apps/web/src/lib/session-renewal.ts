import type { RefreshOutcome } from '@/lib/refresh-access-token';

/**
 * How long before `expiresAt` a renewal is attempted.
 *
 * Sets the refresh rate, the fan-out width, and the pressure on the API's
 * throttle — and the rotation design depends on the gap between two uses of one
 * token staying in minutes: lineage-based reuse detection is sound only because
 * a freshly issued token is not presented again for many minutes, while a stale
 * write from a raced burst lands within seconds. Those two timescales must not
 * overlap.
 *
 * PAIRED WITH THE PROVIDER'S POLL, and neither number means anything alone. A
 * renewal happens on the first poll at or after `TTL - skew`, so a poll interval
 * longer than the remaining window renews only AFTER the token is already dead:
 * at a 900s TTL, a 600s poll and a 60s skew, the polls land at 600 (too early)
 * and 1200 (300s late) and the tab holds a dead token for a fifth of every
 * cycle. The invariant that avoids it is `refetchInterval <= skew`, and the
 * chosen pair — a 300s poll against this 360s skew — renews at the 600s poll,
 * still 600s between one token being issued and re-presented. See
 * `AppSessionProvider`; changing either number without the other reintroduces
 * the gap.
 */
export const REFRESH_SKEW_SECONDS = 360;

/** The token fields the renewal decision reads and writes. */
export type RenewableToken = {
  accessToken?: unknown;
  refreshToken?: string;
  expiresAt?: number;
  error?: string;
  picture?: string | null;
};

/** What the surrounding call knows that the token itself cannot say. */
export type RenewalContext = {
  /**
   * Whether this call can actually write the rotated cookie back.
   *
   * ROTATION IS ONE-TIME-USE AND SIDE-EFFECTING. A Server Component cannot write
   * a cookie, and `/`, `/login` and `/register` are exempt from the route
   * matcher, so there is no middleware response to carry a `Set-Cookie` either.
   * Rotating during an RSC render mints a successor and DISCARDS it — the
   * browser keeps the spent token, and once the grace window closes its next use
   * reads as reuse, revoking the family and logging an ordinary page view as
   * theft. That is the default outcome for a signed-in user opening the landing
   * page near expiry, not an edge case.
   */
  canPersist: boolean;
  /**
   * next-auth's trigger, which is `'update'` only on a POST to
   * `/api/auth/session`.
   *
   * Doubles as the FORCE-RENEW signal. A 401 from the API is positive evidence
   * that the access token is dead regardless of what `expiresAt` claims — a
   * password change elsewhere revokes it mid-life — so recovery needs a way to
   * say "renew now" that the clock alone cannot express. Reading only the
   * PRESENCE of the trigger keeps the ignore-the-payload rule below intact.
   */
  trigger?: string;
  /** Epoch seconds. Passed in so the boundary is testable without a fake clock. */
  nowSeconds: number;
};

/** The two network reads the decision may perform, injected so they can be stubbed. */
export type RenewalDeps = {
  refresh: (refreshToken: string) => Promise<RefreshOutcome>;
  fetchAvatar: (accessToken: string) => Promise<string | null | undefined>;
};

/**
 * Decide what one non-sign-in pass through the `jwt` callback does to the token.
 *
 * Extracted from `auth.ts` so it is actually covered: the vitest config collects
 * only `src/**` and `app/**`, so a spec beside `auth.ts` at the app root would be
 * silently skipped, and every rule below would go unchecked — which is how the
 * skew boundary came to swallow the avatar re-read without a single red test.
 *
 * Mutates and returns the token it was given, matching what next-auth expects
 * back from the callback.
 */
export async function applyRenewal<T extends RenewableToken>(
  token: T,
  { canPersist, trigger, nowSeconds }: RenewalContext,
  deps: RenewalDeps,
): Promise<T> {
  if (!canPersist) return token;

  // No `expiresAt` means a cookie minted before this feature existed. It is
  // flagged terminal and the user signs in once, and that IS the whole deploy
  // migration. Grandfathering was the earlier design and was rejected: it needed
  // a `canRefresh` flag plus a legacy branch here AND a matching one in the
  // recovery path, and without both a legacy user is NEVER signed out and sits
  // on an app where every request 401s — the exact symptom this change exists to
  // remove. Deleting the branch deletes the bug class. Do not reintroduce it.
  //
  // It is also why the API must not be deployed behind the web app: an older API
  // answers login without a refresh token, every new session lands here on its
  // first navigation, and nobody can get in at all. See the deployment guide.
  if (typeof token.expiresAt !== 'number' || !token.refreshToken) {
    token.error = 'RefreshTokenError';
    return token;
  }

  // Already terminal. Re-presenting a token the API has refused, on every
  // navigation, achieves nothing and looks like a retry storm from the outside.
  if (token.error) return token;

  const forced = trigger === 'update';

  if (forced || nowSeconds >= token.expiresAt - REFRESH_SKEW_SECONDS) {
    const renewed = await deps.refresh(token.refreshToken);
    if (renewed.status === 'ok') {
      token.accessToken = renewed.accessToken;
      token.refreshToken = renewed.refreshToken;
      token.expiresAt = renewed.expiresAt;
      delete token.error;
    } else if (renewed.status === 'expired') {
      // HTTP 401 and nothing else — see `refreshAccessToken`. The refresh token
      // is dropped as well as flagged, so nothing keeps re-presenting a
      // credential already known dead. Returning here also keeps the avatar read
      // below from spending a round trip on a token that is now dead.
      token.error = 'RefreshTokenError';
      delete token.refreshToken;
      return token;
    }
    // `transient` falls through untouched, with NO error set. A 5xx, a 429 or a
    // dropped connection is not evidence about the session, and treating it as
    // evidence is how an outage becomes a mass logout.
  }

  // `useSession().update(data)` POSTs `data` from the BROWSER and it arrives
  // here. Writing it into the signed cookie would let any script — and
  // `next.config.ts` concedes that `script-src` still carries 'unsafe-inline',
  // so injected inline script runs — persist an arbitrary image URL for the
  // session's full lifetime. So the payload is ignored entirely and the value is
  // re-read from the API instead: the client's role is to say SOMETHING CHANGED,
  // never to say what it changed to.
  //
  // AFTER the renewal above rather than before it, so the read never uses a
  // token this call was about to replace.
  if (forced && typeof token.accessToken === 'string') {
    const refreshed = await deps.fetchAvatar(token.accessToken);
    // `undefined` means the read itself failed; leave the token as it was rather
    // than clearing a picture over a transient error.
    if (refreshed !== undefined) token.picture = refreshed;
  }

  return token;
}
