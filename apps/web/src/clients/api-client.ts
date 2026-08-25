import { z } from 'zod';
import { createApiClient } from '@chatofy/api-client';
import {
  authMessageSchema,
  translateResponseSchema,
  voiceGenderSchema,
  type ForgotPasswordRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type TranslateRequest,
  type VerifyEmailRequest,
} from '@chatofy/types';
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
  return api.apiFetch(`/translate/voices?language=${language}`, ttsVoicesResponseSchema);
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
