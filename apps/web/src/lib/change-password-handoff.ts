import type { AuthSession } from '@chatofy/types';

/**
 * The server half of changing a password from Settings › Account.
 *
 * A password change revokes every credential issued before it — this browser's
 * included — and the API answers with a REPLACEMENT session. That session has to
 * end up in the httpOnly JWE cookie, and its refresh token must never pass
 * through client JS on the way. So the call is made from the Next server, inside
 * the `password-change` Credentials provider's `authorize()` in `auth.ts`, and
 * Auth.js writes the cookie through its ordinary sign-in pass.
 *
 * Here rather than in `auth.ts` because the vitest config collects only `src/**`
 * and `app/**`: a spec beside `auth.ts` would be silently skipped. Pure, too — no
 * runtime import of `next-auth`, which does not load under vitest — so the
 * `CredentialsSignin` subclass that carries a failure to the client lives in
 * `auth.ts`.
 */

/** Why the change did not happen. Each needs a different next step from the user. */
export type ChangePasswordFailure =
  'wrong-current' | 'no-password' | 'invalid' | 'rate-limited' | 'session-expired' | 'server';

export type ChangePasswordOutcome = { session: AuthSession } | { failure: ChangePasswordFailure };

/**
 * Status to failure, and ONLY 401 is "session expired".
 *
 * The API answers a wrong current password with 403 precisely so that it can
 * never be mistaken for a dead session; folding any other status into
 * `session-expired` here would rebuild that confusion one layer up.
 */
function failureFor(status: number): ChangePasswordFailure {
  switch (status) {
    case 400:
      return 'invalid';
    case 401:
      return 'session-expired';
    case 403:
      return 'wrong-current';
    case 409:
      return 'no-password';
    case 429:
      return 'rate-limited';
    default:
      return 'server';
  }
}

export async function requestPasswordChange(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  input: { accessToken: string; currentPassword: string; newPassword: string },
): Promise<ChangePasswordOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiBaseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      }),
    });
  } catch {
    // Unreachable. Says nothing about the password or the session.
    return { failure: 'server' };
  }

  if (!res.ok) return { failure: failureFor(res.status) };

  const envelope = (await res.json().catch(() => null)) as { data?: AuthSession } | null;
  // A 200 without a usable pair is a server defect, not a reason to sign anyone
  // out: the change may well have committed, and the user can retry or sign in.
  if (!envelope?.data?.token?.accessToken || !envelope.data.token.refreshToken) {
    return { failure: 'server' };
  }
  return { session: envelope.data };
}
