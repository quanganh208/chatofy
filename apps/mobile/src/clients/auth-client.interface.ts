// Auth session shape comes from the shared contract (@chatofy/types):
// { user: User, token: AuthToken } — the same shape the api's auth endpoints
// return, so a real client can pass responses through unchanged.
import type { AuthMessage, AuthSession, AuthToken } from '@chatofy/types';

export type { AuthMessage, AuthSession, AuthToken };

/** Thrown by `getAccessToken` when no one is signed in, or the session has ended. */
export class SignedOutError extends Error {
  constructor(message = 'Not signed in') {
    super(message);
    this.name = 'SignedOutError';
  }
}

// The app talks to auth only through this interface; `HttpAuthClient` is the concrete one.
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
  /**
   * A bearer token that is valid right now, renewing the pair first when the
   * stored one is about to expire. Every API and socket call reads its token
   * here, so a reconnect late in a call never presents an expired one.
   *
   * @throws SignedOutError when nobody is signed in or the API refused the
   * refresh token (the session is then cleared); any other error is a transient
   * failure and leaves the session in place.
   */
  getAccessToken(): Promise<string>;
  onAuthChange(callback: (session: AuthSession | null) => void): () => void;
}
