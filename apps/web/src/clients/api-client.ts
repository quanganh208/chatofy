import { createApiClient } from '@chatofy/api-client';
import { translateResponseSchema, type TranslateRequest } from '@chatofy/types';
import { env } from '@/config/env';

/**
 * Shared API client for the web app. Validates every response against the
 * shared contract (see @chatofy/api-client). Supersedes the old hand-rolled
 * IApiClient — the contract has stabilised, so this is the "@chatofy/sdk" the
 * earlier interface deferred.
 */
const api = createApiClient({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL });

/** Turn-based vi→en translation: send recorded audio + quality, get text + audio. */
export function translate(body: TranslateRequest) {
  return api.apiFetch('/translate', translateResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
