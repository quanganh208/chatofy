import type { AuthSession } from '@chatofy/types';

/**
 * The access token this machine's captures authenticate with.
 *
 * `chrome.storage.local`, never `sync`: a bearer credential is this machine's,
 * and carrying it to another one would sign someone in somewhere they never
 * asked to be. Kept out of `CaptureSettings` for the same reason — that object
 * is written back by `saveSettings` every time the popup changes a dropdown,
 * and a credential has no business riding along.
 *
 * There is no refresh flow. A token lives seven days and then the person signs
 * in again; nothing here tries to renew one.
 */
const KEY = 'chatofy.accessToken';

export async function loadAccessToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function saveAccessToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [KEY]: token });
}

export async function clearAccessToken(): Promise<void> {
  await chrome.storage.local.remove(KEY);
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

  const token = body.data.token.accessToken;
  await saveAccessToken(token);
  return { ok: true, token };
}
