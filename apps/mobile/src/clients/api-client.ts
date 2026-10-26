/**
 * The mobile app's client for the API's enveloped REST routes, built on the shared
 * `@chatofy/api-client` so every response is validated against the same contract
 * the web reads.
 *
 * The bearer comes from the signed-in session on every call, renewed first when it
 * is about to expire; with nobody signed in the call throws `SignedOutError`.
 */

import { createApiClient } from '@chatofy/api-client';
import {
  conferenceDetailResponseSchema,
  conferenceMinutesResponseSchema,
  storedConferenceMinutesResponseSchema,
  type GenerateMinutesRequest,
  type LanguageCode,
} from '@chatofy/types';
import { API_BASE_URL } from '@/config/api-base-url';
import { authClient } from './auth-client';

const api = createApiClient({
  baseUrl: API_BASE_URL,
  getHeaders: async () => ({ authorization: `Bearer ${await authClient.getAccessToken()}` }),
});

/** One room with its participants. 404 for a room the caller neither owns nor joined. */
export function getConference(conferenceId: string) {
  return api.apiFetch(
    `/conference/${encodeURIComponent(conferenceId)}`,
    conferenceDetailResponseSchema,
  );
}

/** A room's stored minutes; `minutes` is null until somebody generates them. */
export function getConferenceMinutes(conferenceId: string) {
  return api.apiFetch(
    `/conference/${encodeURIComponent(conferenceId)}/minutes`,
    storedConferenceMinutesResponseSchema,
  );
}

/** Generate (or regenerate) a room's one stored copy of the minutes, in `language`. */
export function generateConferenceMinutes(conferenceId: string, language: LanguageCode) {
  const body: GenerateMinutesRequest = { language };
  return api.apiFetch(
    `/conference/${encodeURIComponent(conferenceId)}/minutes`,
    conferenceMinutesResponseSchema,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
