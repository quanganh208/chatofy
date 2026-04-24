/**
 * Provider-agnostic auth adapter contract.
 * Concrete implementations live in adapters/ (supabase, better-auth, custom, noop).
 * Bind via AUTH_ADAPTER injection token so implementations are swappable.
 */

export const AUTH_ADAPTER = Symbol('AUTH_ADAPTER');

/** Claims extracted from a verified token. */
export interface AuthClaims {
  sub: string;
  email?: string;
  role?: string;
  /** Raw provider-specific claims — avoid depending on these in business logic. */
  raw?: Record<string, unknown>;
}

/** Normalized user identity returned from the auth provider. */
export interface UserIdentity {
  id: string;
  email: string;
  displayName?: string;
}

export interface AuthAdapter {
  /** Verify an inbound token and return normalized claims. */
  verifyToken(token: string): Promise<AuthClaims>;

  /** Fetch a user identity from the provider by user ID. */
  getUser(userId: string): Promise<UserIdentity>;

  /**
   * Issue a token for a user (optional — only supported by non-external providers).
   * External providers (Supabase, etc.) manage tokens themselves.
   */
  issueToken?(userId: string): Promise<string>;
}
