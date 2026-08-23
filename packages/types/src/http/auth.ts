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
  // Bounded, and stripped of control characters.
  //
  // The maximum is not cosmetic: this value is embedded in the registration JWT
  // that becomes `?token=…` in the mailed verification link, so an unbounded
  // name produces a link past what mail clients wrap and past several
  // proxies' request-line limits — and that user's verification then silently
  // never works.
  //
  // The CR/LF strip is the second half. Nothing user-supplied reaches a mail
  // body, subject or header today, and the dispatch type has no field for it —
  // but a greeting is the obvious future addition, and a name carrying
  // `\r\n` is a header-injection payload waiting for one. Refused at the edge
  // rather than relied upon to be re-stripped at every boundary later.
  name: z
    .string()
    .min(1)
    .max(80)
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
      message: 'Name cannot contain control characters',
    }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// The one password rule, referenced rather than restated. Reset must not be able
// to set a password registration would have refused, and two copies of `.min(8)`
// is exactly how that drifts.
export const passwordSchema = registerRequestSchema.shape.password;

// Verification: the token from the mailed link, and nothing else. The account it
// creates is described entirely by the token — an email or a name in this
// body would be a second, caller-controlled source for facts the token already
// carries, and the token is the one that was mailed to a proven address.
export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * What register, verify, forgot and reset answer with.
 *
 * One shape for all four, and it carries a message and nothing else. That is not
 * minimalism: register answers a fresh address and an already-registered one
 * IDENTICALLY, so anything derived from which case occurred — an id, a status
 * flag, a different wording — would be the account-existence oracle these routes
 * exist to close. A shared schema makes divergence a compile error rather than a
 * judgement call at four call sites.
 *
 * The web client validates every response against a schema, so a body with no
 * schema has nothing to parse against.
 */
export const authMessageSchema = z.object({
  message: z.string(),
});
export type AuthMessage = z.infer<typeof authMessageSchema>;

/**
 * The two messages `POST /auth/verify-email` answers with.
 *
 * Shared rather than owned by the API alone, because the web page has to tell
 * them apart: a re-followed link must render as a plain notice, not an error,
 * and both cases are a 200. Matching on a substring of copy that lived only in
 * the API would break on a reword — silently, and with green tests on BOTH
 * sides, since each mocks the other. Here, a reword that forgets the caller is
 * a compile error instead.
 *
 * Distinguishing the two leaks nothing: reaching either needs a valid
 * verification token, which only someone who already knows the address holds.
 */
export const VERIFY_EMAIL_MESSAGES = {
  created: 'Your account is ready. Sign in to get started.',
  alreadyExists: 'That account already exists. Sign in to get started.',
} as const;

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
