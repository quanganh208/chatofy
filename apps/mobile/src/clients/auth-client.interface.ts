// Auth session shape comes from the shared contract (@chatofy/types):
// { user: User, token: AuthToken } — the same shape the api's auth endpoints
// return, so a real client can pass responses through unchanged.
import type { AuthMessage, AuthSession, AuthToken } from '@chatofy/types';

export type { AuthMessage, AuthSession, AuthToken };

// Interface for auth providers — swap StubAuthClient for Supabase/BetterAuth without touching call sites
export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  /**
   * Begins registration. Returns a MESSAGE, not a session — `POST /auth/register`
   * creates no account and signs nobody in. The account exists once the mailed
   * verification link is followed, and the caller signs in afterwards.
   *
   * Typed against the shared contract even though this client is a stub, so it
   * cannot sit here disagreeing with what the API actually answers.
   */
  signUp(email: string, password: string, name: string): Promise<AuthMessage>;
  signOut(): Promise<void>;
  /**
   * Trades a refresh token for a fresh pair. Returns only the TOKEN half — the
   * API's `POST /auth/refresh` does not re-send the profile, so a refresh
   * cannot silently overwrite a locally edited one.
   *
   * One use only: the token handed in is spent by the call, and the successor
   * arrives in the result. A caller that keeps presenting the old one has its
   * whole family revoked.
   */
  refreshSession(refreshToken: string): Promise<AuthToken>;
  getSession(): Promise<AuthSession | null>;
  onAuthChange(callback: (session: AuthSession | null) => void): () => void;
}
