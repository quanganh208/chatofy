import { createApiClient } from '@chatofy/api-client';
import { env } from '@/config/env';
import { API_TIMEOUT_MS } from '@/config/constants';

/**
 * Shared API client for the mobile app. Validates every response against the
 * shared contract and preserves the timeout the old FetchApiClient enforced.
 * Supersedes that client + IApiClient (now the shared @chatofy/api-client).
 */
export const api = createApiClient({
  baseUrl: env.EXPO_PUBLIC_API_BASE_URL,
  timeoutMs: API_TIMEOUT_MS,
});
