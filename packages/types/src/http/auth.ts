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

// Google login — the client hands over the id_token it received from Google and
// the API verifies it server-side against Google's JWKS. Only the id_token
// crosses this boundary: an access_token would prove nothing about identity.
export const googleLoginRequestSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof googleLoginRequestSchema>;

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
