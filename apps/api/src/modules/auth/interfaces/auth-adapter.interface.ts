/** DI injection token — use Symbol to avoid string collision. */
export const AUTH_ADAPTER = Symbol('AUTH_ADAPTER');

/** Decoded claims extracted from a verified token. */
export interface AuthClaims {
  sub: string;
  email?: string;
  [key: string]: unknown;
}

/** Minimal user identity returned by the auth provider. */
export interface UserIdentity {
  id: string;
  email: string;
  name?: string;
}

/** Overrides for a minted token. */
export interface IssueTokenOptions {
  /** Epoch seconds to stamp as `iat`; `exp` is measured from it. */
  issuedAtSeconds?: number;
}

/**
 * Provider-agnostic auth adapter interface.
 * Swap implementations (Supabase, BetterAuth, custom JWT) without touching core modules.
 */
export interface AuthAdapter {
  verifyToken(token: string): Promise<AuthClaims>;
  getUser(userId: string): Promise<UserIdentity>;
  /**
   * Optional — only for providers that issue tokens themselves (e.g. custom JWT).
   *
   * `issuedAtSeconds` overrides the token's `iat`. Only a password change uses it:
   * see `PasswordChangeService` for why its replacement token must not carry `now`.
   */
  issueToken?(userId: string, opts?: IssueTokenOptions): Promise<string>;
}
