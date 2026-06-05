// Auth HTTP contracts — schema-first. Request schemas validate INPUT (so email
// format is enforced here); response/domain schemas stay permissive on output.
import { z } from 'zod';
import { userSchema } from '../domain/user.js';

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const authTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.string(),
});
export type AuthToken = z.infer<typeof authTokenSchema>;

export const authSessionSchema = z.object({
  user: userSchema,
  token: authTokenSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

// Known auth providers — the SINGLE source for the allowlist. Used by both the
// public GET /auth/providers response contract AND the api's AUTH_PROVIDER env
// validation, so the api can never advertise a provider outside this set.
// Adding a provider = extend this enum (one place).
export const authProviderSchema = z.enum(['none', 'noop']);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const authProvidersResponseSchema = z.object({
  provider: authProviderSchema,
});
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;
