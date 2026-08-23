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

/**
 * Provider-agnostic auth adapter interface.
 * Swap implementations (Supabase, BetterAuth, custom JWT) without touching core modules.
 */
export interface AuthAdapter {
  verifyToken(token: string): Promise<AuthClaims>;
  getUser(userId: string): Promise<UserIdentity>;
  /** Optional — only for providers that issue tokens themselves (e.g. custom JWT). */
  issueToken?(userId: string): Promise<string>;
}
