import { env } from '@/config/env';

/**
 * What one attempt at renewal concluded.
 *
 * THE THREE-WAY SPLIT IS THE POINT. Collapsing `transient` into `expired` turns
 * every 5xx, 429 and dropped connection into a forced sign-out, so a
 * thirty-second outage logs out every active user — and they cannot sign back
 * in, because login needs the same infrastructure that just failed. Collapsing
 * it the other way leaves a genuinely dead session renewing forever.
 */
export type RefreshOutcome =
  | { status: 'ok'; accessToken: string; refreshToken: string; expiresAt: number }
  | { status: 'expired' }
  | { status: 'transient' };

/** What the API answers on a successful renewal. */
type RefreshEnvelope = {
  data?: { accessToken?: string; refreshToken?: string; expiresAt?: string };
};

/**
 * Trades a refresh token for a fresh pair.
 *
 * ONLY HTTP 401 IS TERMINAL. Everything else — 5xx, 503, 404, 429, a network
 * error, the timeout below — is transient, and the API is written to match:
 * `POST /auth/refresh` answers 503 rather than 401 when its token store is
 * unreachable, precisely so this function cannot read an outage as a dead
 * session. 404 is in the transient set for the deploy window: a web build that
 * reaches an API without this route yet must not sign anybody out.
 *
 * Bounded at five seconds because it runs INSIDE the `jwt` callback, the same
 * reason the avatar read is bounded. An unbounded read against a hung API
 * stalls `/api/auth/session`, so `update()` never resolves and every caller
 * waiting on it hangs with it.
 *
 * Lives in `src/` rather than beside `auth.ts` so its spec actually runs: the
 * vitest config includes only `src/**` and `app/**`, so a spec at the app root
 * would be silently skipped — which for this file would mean the
 * 401-only-is-terminal rule was never checked at all.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Unreachable, or slower than the bound. Says nothing about the token.
    return { status: 'transient' };
  }

  if (res.status === 401) return { status: 'expired' };
  if (!res.ok) return { status: 'transient' };

  const envelope = (await res.json().catch(() => null)) as RefreshEnvelope | null;
  const token = envelope?.data;
  if (!token?.accessToken || !token.refreshToken || !token.expiresAt) {
    // A 200 that does not carry a usable pair is a fault, not a verdict. Signing
    // out on it would let a malformed deploy log out the user base.
    return { status: 'transient' };
  }

  const expiresAt = Math.floor(Date.parse(token.expiresAt) / 1000);
  if (!Number.isFinite(expiresAt)) return { status: 'transient' };

  return {
    status: 'ok',
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    // EPOCH SECONDS, converted exactly once, here. The contract sends an ISO
    // string; every comparison downstream is in seconds. Mixing the two units
    // makes a session look either permanently expired or permanently fresh, and
    // both failures are silent.
    expiresAt,
  };
}
