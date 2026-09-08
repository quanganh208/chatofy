import { z } from 'zod';
import { ApiClientError, createApiClient, type ApiRequestOptions } from '@chatofy/api-client';
import {
  authMessageSchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  conversationSummaryResponseSchema,
  minutesResponseSchema,
  userSchema,
  voiceGenderSchema,
  type ForgotPasswordRequest,
  type GenerateMinutesRequest,
  type LanguageCode,
  type RegisterRequest,
  type SaveConversationRequest,
  type ResetPasswordRequest,
  type UpdateMeRequest,
  type UploadAvatarRequest,
  type VerifyEmailRequest,
} from '@chatofy/types';
import { getSession } from 'next-auth/react';
import { env } from '@/config/env';
import { recoverFromUnauthorized } from '@/lib/session-recovery';

/**
 * Shared API client for the web app. Validates every response against the
 * shared contract (see @chatofy/api-client). Supersedes the old hand-rolled
 * IApiClient — the contract has stabilised, so this is the "@chatofy/sdk" the
 * earlier interface deferred.
 */
const api = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
});

/**
 * The bearer header, or nothing at all.
 *
 * Omitted entirely rather than sent as `Bearer undefined`, which produces a
 * clean 401 instead of a token the API has to parse before rejecting.
 */
function withAuth(
  init: ApiRequestOptions | undefined,
  accessToken: string | undefined,
): ApiRequestOptions {
  if (!accessToken) return init ?? {};
  return { ...init, headers: { ...init?.headers, authorization: `Bearer ${accessToken}` } };
}

/** A 401 from the API, as opposed to any other failure. */
function isUnauthorized(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError && err.status === 401;
}

/**
 * Every authenticated call, with the ONE 401 recovery path attached.
 *
 * A local wrapper rather than something in `@chatofy/api-client`, deliberately:
 * the retry depends on an Auth.js session, and the shared client is consumed by
 * React Native too, where there is no such session to recover into. The comment
 * on `ApiRequestOptions` — that a failing header producer is the caller's
 * error — already anticipated this split.
 *
 * The token is resolved HERE rather than by the client's `getHeaders` so this
 * knows exactly which token produced a 401. That matters: `recoverFromUnauthorized`
 * decides `refreshed` versus `transient` by comparing against it, and a
 * `getSession()` read performed after the failure would already carry the
 * successor. It is still one session read per request, the same cost as before.
 *
 * RETRIED EXACTLY ONCE, bounded by having no loop at all: an endpoint that 401s
 * for a reason no token can fix must not be able to spin here.
 */
async function authedFetch<T extends z.ZodType>(
  path: string,
  dataSchema: T,
  init?: ApiRequestOptions,
): Promise<z.infer<T>> {
  const sent = (await getSession())?.accessToken;
  try {
    return await api.apiFetch(path, dataSchema, withAuth(init, sent));
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    if ((await recoverFromUnauthorized(getSession, sent)) !== 'refreshed') throw err;
    const renewed = (await getSession())?.accessToken;
    return api.apiFetch(path, dataSchema, withAuth(init, renewed));
  }
}

/**
 * Generate meeting minutes for a stored conversation.
 *
 * Carries no transcript: the API holds one now, and the URL names it. The
 * response is owner-scoped server-side; nothing here passes a user id, and it
 * must not — the owner is the token's subject.
 */
export function generateMinutes(conversationId: string, language?: LanguageCode) {
  const body: GenerateMinutesRequest = language ? { language } : {};
  return authedFetch(
    `/conversations/${encodeURIComponent(conversationId)}/minutes`,
    minutesResponseSchema,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/**
 * Save (or fully replace) a finished conversation.
 *
 * PUT because the client owns the id and sends the whole conversation, so a
 * re-save after a roster edit replaces rather than duplicating. The turns are
 * DISPLAY BLOCKS produced by `toConversationTurns` — already grouped and
 * repaired — so what is stored is what the user read.
 *
 * Goes through `api` like everything else, and deliberately not through a bare
 * `fetch` with `keepalive`. Two reasons, both load-bearing: `ApiRequestOptions`
 * is `{method, headers, body}` and not `RequestInit`, so `keepalive` cannot be
 * passed without changing a package shared with mobile; and the Fetch standard
 * caps keepalive bodies at 64KiB, far below this feature's own ~520KB ceiling,
 * so it would fail exactly on the long conversations history exists for.
 */
export function saveConversation(conversationId: string, body: SaveConversationRequest) {
  return authedFetch(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationSummaryResponseSchema,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

/**
 * The caller's past conversations, newest first.
 *
 * Cursor-paged, and the cursor is in the PAYLOAD rather than the envelope meta:
 * this is keyset paging and the envelope's pagination block is page-based. Pass
 * a previous page's `nextCursor` back as `cursor`; null means that was the last.
 */
export function listConversations(options: { limit?: number; cursor?: string; q?: string } = {}) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  // Omitted when empty rather than sent blank: `?q=` under the minimum length is
  // a 400, and "cleared the box" must mean "list everything".
  if (options.q) query.set('q', options.q);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return authedFetch(`/conversations${suffix}`, conversationListResponseSchema);
}

/** One stored conversation with its transcript (404 → throws). */
export function getConversation(conversationId: string) {
  return authedFetch(
    `/conversations/${encodeURIComponent(conversationId)}`,
    conversationResponseSchema,
  );
}

/**
 * Delete a conversation and its transcript. Its minutes go with it.
 *
 * Answers 204, which `apiFetch` maps by parsing `undefined` against the data
 * schema — hence `z.undefined()` rather than an object nothing will send.
 */
export function deleteConversation(conversationId: string) {
  return authedFetch(`/conversations/${encodeURIComponent(conversationId)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/** Fetch the caller's previously generated minutes for a conversation (404 → throws). */
export function getMinutes(conversationId: string) {
  return authedFetch(
    `/conversations/${encodeURIComponent(conversationId)}/minutes`,
    minutesResponseSchema,
  );
}

/**
 * One voice the running speech backend offers.
 *
 * `token` is opaque — an integer id to one engine, a preset name to another — and
 * is only ever echoed back to the server. Nothing here may interpret it.
 */
const ttsVoiceSchema = z.object({
  token: z.string(),
  label: z.string(),
  gender: voiceGenderSchema,
});
const ttsVoicesResponseSchema = z.object({ voices: z.array(ttsVoiceSchema) });
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

/**
 * Voices available for a language.
 *
 * Goes through `api`, not a bare `fetch`, because this route is authenticated
 * like every other one on the controller — `JwtAuthGuard` is a global guard and
 * nothing here is `@Public()`. A hand-rolled fetch would 401, and a caller that
 * treats any failure as "no voices" would then hide the picker forever while
 * every test still passed.
 */
export function listVoices(language: 'vi' | 'en') {
  return authedFetch(`/translate/voices?language=${language}`, ttsVoicesResponseSchema);
}

/**
 * The signed-in caller's own profile: id, email, name, `createdAt`.
 *
 * Enveloped, unlike `/health`, so it goes through `api` — and it is guarded, so the
 * bearer header `api` resolves per request is what makes it answer at all. A 401 here
 * means the session has aged out; `use-auth-recovery.ts` is the path that acts on that,
 * and this one simply reports the failure to whoever asked.
 *
 * There is no `emailVerified` field to read and that is by design: the row is created
 * by redeeming the verification link, so an account that exists has always been
 * verified. See `registration.service.ts`.
 */
export function getMe() {
  return authedFetch('/auth/me', userSchema);
}

/**
 * Changes a setting on the caller's own row — today, the language their mail is
 * written in.
 *
 * Enveloped and guarded like `getMe`, and it names no user id: which row changes is
 * decided by the verified token, never by anything this client sends.
 */
export function updateMe(body: UpdateMeRequest) {
  return authedFetch('/auth/me', userSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Replaces the caller's avatar. `body.image` is RAW base64, not a data URL — the
 * API decides the type from the bytes and would discard a declared one.
 *
 * Names no user id, for the same reason `updateMe` does not.
 */
export function uploadAvatar(body: UploadAvatarRequest) {
  return authedFetch('/auth/me/avatar', userSchema, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * Removes the caller's avatar.
 *
 * A 409 here is not a bug: removal is authoritative at the origin, so an
 * unreachable or unconfigured bucket fails LOUDLY rather than clearing the field
 * while the object stays published. The message is worth showing — a 4xx keeps
 * it through the API's error filter, which a 5xx would not.
 */
export function deleteAvatar() {
  return authedFetch('/auth/me/avatar', userSchema, { method: 'DELETE' });
}

/**
 * Register, verify, forgot- and reset-password — a second client instance, with
 * no `getHeaders`.
 *
 * `api` above resolves its header from `getSession()` on every call, which is a
 * `/api/auth/session` round trip for a header that is always `{}` on these four
 * routes: all of them are `@Public()`, and `/verify-email` and
 * `/reset-password` are, by construction, opened by a visitor who has never
 * signed in. Reusing `api` would spend that round trip only to resolve it to
 * nothing every time; omitting `getHeaders` skips the round trip itself.
 */
const publicApi = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
});

/**
 * Begins registration. Answers identically for a fresh address and one that
 * already has an account, and creates neither an account nor a session — see
 * `authMessageSchema`.
 */
export function register(body: RegisterRequest) {
  return publicApi.apiFetch('/auth/register', authMessageSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Redeems a verification link. This is what creates the account. */
export function verifyEmail(body: VerifyEmailRequest) {
  return publicApi.apiFetch('/auth/verify-email', authMessageSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Requests a reset link. Answers identically for a known and an unknown address. */
export function forgotPassword(body: ForgotPasswordRequest) {
  return publicApi.apiFetch('/auth/forgot-password', authMessageSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Redeems a reset link and sets a new password. Returns no session. */
export function resetPassword(body: ResetPasswordRequest) {
  return publicApi.apiFetch('/auth/reset-password', authMessageSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Liveness for the translation service: does `GET /health` answer at all.
 *
 * Deliberately NOT through either client above. `TransformInterceptor` skips
 * `/health*` so probe consumers get a stable raw body, which means the enveloped
 * `apiFetch` would reject every successful response — and a readiness card built on
 * it would report the service unreachable while it was serving fine.
 *
 * The timeout is the point of the call. Without one a dead host leaves the request
 * hanging until the browser gives up, and a card that says "Checking…" for thirty
 * seconds is telling the user less than "Unreachable" would.
 *
 * Resolves on a healthy answer and throws on anything else. There is no third
 * outcome to model: the caller only needs to know whether it could reach it.
 */
export async function checkHealth(signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/health`, {
    signal: signal ?? AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`health responded ${response.status}`);
  healthSchema.parse(await response.json());
}

/** The raw probe body, mirrored from `apps/api/src/modules/health/dto/health.dto.ts`. */
const healthSchema = z.object({ status: z.literal('ok'), time: z.string() });
