import type { AuthSession, AuthToken } from '@chatofy/types';
import { clearTokens, loadAccessToken, loadRefreshToken, saveTokens } from './token-storage';

/**
 * What this machine's captures authenticate with, and how it is renewed.
 *
 * The extension talks to the API directly rather than through the web app's
 * session cookie: an MV3 service worker shares no cookie jar with the web
 * origin, and the session token there is readable only with a secret that must
 * not ship in an extension bundle.
 *
 * An access token now lives fifteen minutes, so there IS a refresh flow: a 401
 * is answered by spending the stored refresh token before anything is thrown
 * away, and a capture asks for a fresh token rather than whatever the popup
 * last stored. What sign-out ends is this browser's refresh family, server-side
 * — every other device the person signed in from keeps its own, and the access
 * token already issued here is not recallable, so it stays usable for whatever
 * is left of its fifteen minutes.
 */

// The popup reads this through here, where the rest of its auth calls live.
export { loadAccessToken };

/** What spending the refresh token settled — including that it settled nothing. */
type RefreshOutcome =
  | { status: 'renewed'; accessToken: string }
  | { status: 'ended' }
  | { status: 'absent' }
  | { status: 'deferred' };

/**
 * Trade the stored refresh token for a new pair.
 *
 * The four outcomes are kept apart because the callers act on them differently,
 * and collapsing any two would lose the distinction this whole file is built
 * around: only the API saying 401 is proof a session is over.
 *
 * - `renewed`  — both tokens replaced. The presented one is spent; the response
 *                carries its successor.
 * - `ended`    — the API refused it. Both keys are cleared here.
 * - `absent`   — nothing stored to spend. A profile signed in before refresh
 *                tokens existed, or one already cleared.
 * - `deferred` — unreachable, rate limited, faulting, slower than the bound
 *                below, or answering something unreadable. Nothing is cleared
 *                and nothing is known.
 *
 * Bounded at five seconds, the same bound the web client puts on this call. An
 * unbounded fetch has no failure mode that ends it: a hung API or a captive
 * portal that accepts the connection and never answers would leave a capture
 * waiting on `getFreshAccessToken` with nothing on screen to act on. The abort
 * lands in the same `catch` as a dropped connection and is `deferred` for the
 * same reason — a question that could not be asked is not an answer of no.
 */
async function refreshAccessToken(apiBaseUrl: string): Promise<RefreshOutcome> {
  const refreshToken = await loadRefreshToken();
  if (refreshToken === null) return { status: 'absent' };

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { status: 'deferred' };
  }

  if (res.status === 401) {
    await clearTokens();
    return { status: 'ended' };
  }
  // A 429 or a 5xx says the API would not answer, not that it answered no.
  if (!res.ok) return { status: 'deferred' };

  // This route returns the token half alone — no user profile — so the envelope's
  // `data` IS the pair.
  const body = (await res.json().catch(() => null)) as { data?: AuthToken } | null;
  const token = body?.data;
  // A 200 nothing could be read out of is a broken deployment or a captive
  // portal's login page, neither of which is a revoked session.
  if (!token?.accessToken) return { status: 'deferred' };

  await saveTokens(token.accessToken, token.refreshToken);
  return { status: 'renewed', accessToken: token.accessToken };
}

/**
 * Is the stored token still one the API will accept?
 *
 * The popup used to infer "signed in" from a stored string being present, which
 * was true while a token could only stop working by expiring — the stored value
 * and the API's answer could not disagree. A password reset now revokes tokens
 * before their `exp`, so they can: the popup would keep saying signed in while
 * every capture failed, and a refused socket upgrade carries no readable status,
 * so the user would see nothing actionable and no reason to press the one button
 * that fixes it.
 *
 * A 401 is the only answer that clears the token. A network failure or a 5xx is
 * NOT proof the session is gone — the API being unreachable would otherwise sign
 * the user out of the extension every time their laptop woke up on a bad
 * network — so those leave the token alone and report it still valid.
 *
 * A 401 no longer clears on its own, though: fifteen minutes is short enough
 * that a popup opened after lunch expects one, and the refresh token is the
 * second question to ask before telling someone they have been signed out. Only
 * a 401 to THAT is the end of the session.
 */
export async function verifyAccessToken(apiBaseUrl: string): Promise<boolean> {
  const token = await loadAccessToken();
  if (token === null) return false;

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return true;
  }

  if (res.status !== 401) return true;

  const refreshed = await refreshAccessToken(apiBaseUrl);
  // `deferred` keeps the session for the same reason an unreachable probe does:
  // a refresh that could not be asked answers nothing about whether it would.
  if (refreshed.status === 'renewed' || refreshed.status === 'deferred') return true;
  // `absent` is the old behaviour, unchanged: with nothing left to ask with, the
  // probe's 401 was the whole answer.
  if (refreshed.status === 'absent') await clearTokens();
  return false;
}

/**
 * The token to open a capture's socket with, renewed first.
 *
 * Reading the stored one was enough while it lived seven days. It lives fifteen
 * minutes now, and an extension is idle between meetings far longer than that:
 * the socket would be refused at the HTTP upgrade, before a socket exists to
 * carry a reason, and the user would see a connection error with nothing to act
 * on. So the renewal happens here, where a failure is still recoverable.
 *
 * A refresh that could not be completed falls back to the stored token rather
 * than refusing to start — it may well have minutes left, and the upgrade is
 * the authority on that either way.
 */
export async function getFreshAccessToken(apiBaseUrl: string): Promise<string | null> {
  const stored = await loadAccessToken();
  // Nothing stored is "sign in first", and asking the API would say no differently.
  if (stored === null) return null;

  const refreshed = await refreshAccessToken(apiBaseUrl);
  if (refreshed.status === 'renewed') return refreshed.accessToken;
  if (refreshed.status === 'ended') return null;
  return stored;
}

/** What a sign-in attempt produced: a token, or something to show the user. */
export type SignInResult = { ok: true; token: string } | { ok: false; message: string };

/**
 * Exchange an email and password for a token, and remember it.
 *
 * Talks to the API directly rather than through `@chatofy/api-client`: the
 * extension does not depend on that package, and this is one POST whose only
 * consumer is the popup.
 *
 * The API's own message is surfaced when it sent one — it answers a wrong
 * password and an unknown email identically on purpose, and rewording it here
 * would only risk saying more than the API chose to.
 */
export async function signIn(
  apiBaseUrl: string,
  email: string,
  password: string,
): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: `Cannot reach ${apiBaseUrl}` };
  }

  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: AuthSession;
    error?: { message?: string };
  } | null;

  if (!res.ok || !body?.data?.token?.accessToken) {
    return {
      ok: false,
      message: body?.error?.message ?? `Sign in failed (HTTP ${res.status})`,
    };
  }

  // Both halves, from the one response that carries them. A sign-in that stored
  // only the access token would leave this profile unable to renew, which is a
  // fifteen-minute session rather than a thirty-day one.
  const token = body.data.token;
  await saveTokens(token.accessToken, token.refreshToken);
  return { ok: true, token: token.accessToken };
}

/**
 * End the session: server-side first, then locally.
 *
 * The revoke is what makes sign-out mean something. Without it, "sign out" left
 * a thirty-day self-renewing credential in the browser profile on disk — on
 * what may be a shared machine — and only stopped this extension from using it.
 *
 * Fired, not awaited. A user leaving must not be held by a request that a
 * captive portal will hang for thirty seconds, so the keys go whatever the API
 * says or fails to say; an unrevoked family expires on its own. `apiBaseUrl` is
 * absent only before storage has answered, which is before this control is on
 * screen — the local half still happens in that case, it just cannot be told.
 */
export async function signOut(apiBaseUrl: string | undefined): Promise<void> {
  const refreshToken = await loadRefreshToken();
  if (refreshToken !== null && apiBaseUrl !== undefined) {
    void fetch(`${apiBaseUrl}/auth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  await clearTokens();
}
