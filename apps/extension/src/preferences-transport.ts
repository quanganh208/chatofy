import { apiResponseSchema, preferencesReadResponseSchema } from '@chatofy/types';
import type { PreferencesTransport } from '@chatofy/api-client';
import { getFreshAccessToken } from './access-token';
import { loadAccessToken } from './token-storage';

/**
 * `/me/preferences` over the extension's own authenticated fetch.
 *
 * The stored access token goes first and a 401 is answered once with a renewed
 * one, rather than renewing before every call the way a capture does:
 * `getFreshAccessToken` spends the refresh token, which is rotated on use, and a
 * popup that saved three times would burn three of them for one fifteen-minute
 * credential. Every failure throws, because the sync store treats a throw as
 * "keep the change and try again" — there is no failure here worth hiding from it.
 */

const envelope = apiResponseSchema(preferencesReadResponseSchema);

/** `status` is the HTTP status when the API answered; the sync store reads it to tell a refusal from a failure. */
export class PreferencesRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export function createPreferencesTransport(
  apiBaseUrl: string,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): PreferencesTransport {
  const send = (token: string, method: string, body?: unknown) =>
    fetchImpl(`${apiBaseUrl}/me/preferences`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function request(method: string, body?: unknown) {
    const stored = await loadAccessToken();
    if (stored === null) throw new PreferencesRequestError('Not signed in');

    let res = await send(stored, method, body);
    if (res.status === 401) {
      const renewed = await getFreshAccessToken(apiBaseUrl);
      if (renewed === null) throw new PreferencesRequestError('Session ended', 401);
      res = await send(renewed, method, body);
    }
    if (!res.ok) throw new PreferencesRequestError(`HTTP ${res.status}`, res.status);

    const parsed = envelope.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !parsed.data.success) {
      throw new PreferencesRequestError('Unreadable preferences response');
    }
    return parsed.data.data;
  }

  return {
    load: () => request('GET'),
    save: (patch) => request('PATCH', { preferences: patch }),
    reset: () => request('DELETE'),
  };
}
