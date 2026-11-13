/**
 * The mobile app's client for the API's enveloped REST routes, built on the shared
 * `@chatofy/api-client` so every response is validated against the same contract
 * the web reads.
 *
 * The bearer comes from the signed-in session on every call, renewed first when it
 * is about to expire; with nobody signed in the call throws `SignedOutError`.
 */

import { z } from 'zod';
import { createApiClient } from '@chatofy/api-client';
import {
  conferenceDetailResponseSchema,
  conferenceMinutesResponseSchema,
  storedConferenceMinutesResponseSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  conversationSummaryResponseSchema,
  creditBalanceSchema,
  creditUsageListReadSchema,
  preferencesResponseSchema,
  voiceGenderSchema,
  type GenerateMinutesRequest,
  type LanguageCode,
  type SaveConversationRequest,
  type UpdatePreferencesRequest,
  type UserPreferencesPatch,
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

/**
 * Stores a finished translate conversation under `conversationId`. A PUT, so
 * sending the same id again replaces it: a retry after a dropped response never
 * makes a second copy.
 */
export function saveConversation(conversationId: string, body: SaveConversationRequest) {
  return api.apiFetch(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationSummaryResponseSchema,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

/**
 * The caller's past conversations, newest first. Keyset-paged: pass a previous
 * page's `nextCursor` back as `cursor`; null means that was the last page.
 */
export function listConversations(options: { limit?: number; cursor?: string; q?: string } = {}) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  // Omitted when empty: a term under the minimum length is a 400, and a cleared box means "list everything".
  if (options.q) query.set('q', options.q);
  const suffix = query.toString();
  return api.apiFetch(
    `/conversations${suffix ? `?${suffix}` : ''}`,
    conversationListResponseSchema,
  );
}

/** One stored conversation with its transcript. 404 for one the caller does not own. */
export function getConversation(conversationId: string) {
  return api.apiFetch(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationResponseSchema,
  );
}

/** Deletes a conversation and its transcript. Answers 204, which parses as `undefined`. */
export function deleteConversation(conversationId: string) {
  return api.apiFetch(`/conversations/${encodeURIComponent(conversationId)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/** One voice the running speech backend offers; `token` is opaque and only echoed back. */
const ttsVoiceSchema = z.object({
  token: z.string(),
  label: z.string(),
  gender: voiceGenderSchema,
});
const ttsVoicesResponseSchema = z.object({ voices: z.array(ttsVoiceSchema) });
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

/** Voices available for a language. */
export function listVoices(language: LanguageCode) {
  return api.apiFetch(`/translate/voices?language=${language}`, ttsVoicesResponseSchema);
}

/** The caller's credit balance, plan and whether this account may check out. */
export function getCreditBalance() {
  return api.apiFetch('/billing/me', creditBalanceSchema);
}

/**
 * The newest page of the caller's credit usage. Read entry by entry, so a usage
 * kind a later API adds drops that row instead of failing the whole list.
 */
export function listCreditUsage() {
  return api.apiFetch('/billing/usage', creditUsageListReadSchema);
}

/** The account's preferences document; defaults while nothing is stored yet. */
export function getPreferences() {
  return api.apiFetch('/me/preferences', preferencesResponseSchema);
}

/** Merges `patch` into the stored document and returns the whole result. */
export function updatePreferences(patch: UserPreferencesPatch) {
  const body: UpdatePreferencesRequest = { preferences: patch };
  return api.apiFetch('/me/preferences', preferencesResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Deletes the stored document and returns the defaults: "Reset to defaults". */
export function resetPreferences() {
  return api.apiFetch('/me/preferences', preferencesResponseSchema, { method: 'DELETE' });
}
