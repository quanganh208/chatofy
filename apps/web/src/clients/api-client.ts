import { createApiClient } from '@chatofy/api-client';
import { translateResponseSchema, type TranslateRequest } from '@chatofy/types';
import { getSession } from 'next-auth/react';
import { env } from '@/config/env';

/**
 * Shared API client for the web app. Validates every response against the
 * shared contract (see @chatofy/api-client). Supersedes the old hand-rolled
 * IApiClient — the contract has stabilised, so this is the "@chatofy/sdk" the
 * earlier interface deferred.
 */
const api = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  /**
   * Every route except the auth ones now requires a token.
   *
   * Resolved per request rather than captured once: `getSession` reads the
   * current cookie, so a sign-out or a session that has aged out is reflected on
   * the next call instead of leaving a stale credential in a closure. The header
   * is omitted entirely when there is no session, which produces a clean 401
   * rather than `Bearer undefined`.
   */
  getHeaders: async (): Promise<Record<string, string>> => {
    const session = await getSession();
    return session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {};
  },
});

/** Turn-based translation: send recorded audio, get text + synthesized audio. */
export function translate(body: TranslateRequest) {
  return api.apiFetch('/translate', translateResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
