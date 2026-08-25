// Auth HTTP contracts — schema-first. Request schemas validate INPUT (so email
// format is enforced here); response/domain schemas stay permissive on output.
import { z } from 'zod';
import { userSchema } from '../domain/user.js';

/**
 * Every length bound the auth contracts enforce, in one block.
 *
 * Named and gathered rather than spelled inline at each field, because the same
 * bound has to hold at more than one route and the drift is silent when it does
 * not: a reset that accepted a password registration would have refused, or a
 * login that rejected a password registration had accepted, is a locked-out user
 * with a validation error that names no rule. One constant per bound means the
 * second route cannot disagree with the first.
 *
 * Each is a CEILING ON COST as much as a rule about content. Every one of these
 * fields arrives on an unauthenticated route, and each is measured before any
 * work is done with it — see the individual notes.
 */
export const AUTH_LIMITS = {
  /**
   * RFC 5321's maximum for a whole address (64 local + @ + 254 total is the
   * practical reading, and 254 is what every mailbox provider enforces). Above
   * this an address cannot be delivered to, so accepting one only stores a row
   * whose verification mail can never arrive.
   */
  maxEmail: 254,

  /**
   * Eight. The floor a new password has to clear, and the ONLY strength rule
   * here — length is the one requirement that measurably helps; composition
   * rules push people toward `Password1!` and a rule this file cannot check
   * against a breach corpus is a rule that costs users more than attackers.
   */
  minPassword: 8,

  /**
   * The longest password any route accepts.
   *
   * Not a strength rule — a cost ceiling. Every route that takes a password
   * spends an argon2 hash or verify on it, and argon2 feeds the whole input
   * through Blake2b before its memory-hard work starts, so the caller picks how
   * much of that they buy. Unbounded, one request can carry megabytes (the JSON
   * body limit is 12 MB, raised so `POST /translate` can hold base64 audio) into
   * a hash on the same libuv threadpool the translate pipeline uses. The route
   * throttles bound how OFTEN that happens; this bounds how BIG each one is.
   *
   * 128 is far above what a password manager generates and far below where the
   * input cost shows next to the memory cost. OWASP asks that at least 64 be
   * allowed; this doubles that.
   */
  maxPassword: 128,

  /** A name has to be something. */
  minName: 1,

  /**
   * The maximum is not cosmetic: this value is embedded in the registration JWT
   * that becomes `?token=…` in the mailed verification link, so an unbounded
   * name produces a link past what mail clients wrap and past several proxies'
   * request-line limits — and that user's verification then silently never
   * works.
   */
  maxName: 80,

  /** A token has to be something. */
  minToken: 1,

  /**
   * Comfortably above the longest token this app mints — the registration one,
   * which carries an address, a name and a sealed hash — and far below what
   * makes signature verification worth doing as an attack. Without it a caller
   * can hand an unauthenticated route megabytes to base64-decode and HMAC.
   */
  maxToken: 4096,
} as const;

/**
 * The one email rule, referenced rather than restated.
 *
 * Format AND length together: `z.email()` alone bounds neither, so the two
 * always travel as a pair.
 */
export const emailSchema = z.email().max(AUTH_LIMITS.maxEmail);

/**
 * The one password RULE — what a new password must satisfy.
 *
 * Registration and reset share it, so a reset cannot set a password
 * registration would have refused. Login does NOT use this: see below.
 */
export const passwordSchema = z.string().min(AUTH_LIMITS.minPassword).max(AUTH_LIMITS.maxPassword);

/**
 * The one token rule, shared by the two routes that redeem a mailed link.
 */
export const linkTokenSchema = z.string().min(AUTH_LIMITS.minToken).max(AUTH_LIMITS.maxToken);

export const loginRequestSchema = z.object({
  email: emailSchema,
  /**
   * Bounded at the same maximum, and deliberately NOT `passwordSchema`.
   *
   * Login checks a credential; it does not enforce a rule. Applying the minimum
   * here would answer a seven-character attempt with a validation error rather
   * than the generic 401 — telling the caller "no account has a password this
   * short", which is a fact about the rules, not about the account, but which
   * still splits one answer into two. The maximum is a cost ceiling and applies
   * regardless, because a verify costs what a hash costs.
   */
  password: z.string().min(1).max(AUTH_LIMITS.maxPassword),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  // Bounded (see AUTH_LIMITS.maxName), and stripped of control characters.
  //
  // The CR/LF strip is the second half. Nothing user-supplied reaches a mail
  // body, subject or header today, and the dispatch type has no field for it —
  // but a greeting is the obvious future addition, and a name carrying
  // `\r\n` is a header-injection payload waiting for one. Refused at the edge
  // rather than relied upon to be re-stripped at every boundary later.
  name: z
    .string()
    .min(AUTH_LIMITS.minName)
    .max(AUTH_LIMITS.maxName)
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
      message: 'Name cannot contain control characters',
    }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// Verification: the token from the mailed link, and nothing else. The account it
// creates is described entirely by the token — an email or a name in this
// body would be a second, caller-controlled source for facts the token already
// carries, and the token is the one that was mailed to a proven address.
export const verifyEmailRequestSchema = z.object({
  token: linkTokenSchema,
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: linkTokenSchema,
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
/**
 * What the answer MEANS, separate from the words it happens to be in.
 *
 * The words are English, minted by the api, and a Vietnamese page rendering them
 * would have its most prominent line in the wrong language. So the wire carries a
 * code and each surface supplies its own prose — the same seam
 * `web/src/components/auth/auth-error-message.ts` already uses for failures,
 * extended to the successes.
 *
 * `message` stays, and is not deprecated. It is the answer for any consumer with no
 * dictionary — curl, a future surface, the api's own OpenAPI page — and it is what
 * makes adding this a widening rather than a break.
 *
 * **Registration has exactly one code**, which is the whole point: a fresh address
 * and an already-registered one answer identically, and a code that differed between
 * them would be the account-existence oracle in machine-readable form. Verify-email's
 * two are safe for the reason recorded beside `VERIFY_EMAIL_MESSAGES`: reaching
 * either needs a token only someone who knows the address holds.
 */
export const authMessageCodeSchema = z.enum([
  'REGISTRATION_ACCEPTED',
  'ACCOUNT_CREATED',
  'ACCOUNT_ALREADY_EXISTS',
  'RESET_REQUESTED',
  'PASSWORD_RESET_DONE',
]);
export type AuthMessageCode = z.infer<typeof authMessageCodeSchema>;

export const authMessageSchema = z.object({
  code: authMessageCodeSchema,
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
 *
 * The web page now tells them apart by `code`, which is what this note asked for
 * without having the mechanism. These strings stay as the api's English answer and
 * as the reason the two cases are documented together.
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
