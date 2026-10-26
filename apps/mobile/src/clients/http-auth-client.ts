/**
 * The concrete AuthClient: the API's own email/password routes, with the session
 * kept in a `SessionStore` (secure storage on device, a map in tests).
 *
 * Pure — no React Native imports — so the refresh rules below run under
 * `node --test`. The rules are the web's (`apps/web/src/lib/refresh-access-token.ts`):
 *
 * - ONLY a 401 from `POST /auth/refresh` ends the session. A 5xx, 429, timeout or
 *   dropped connection is transient: the call fails, the session stays, and the
 *   next call tries again. Reading an outage as a sign-out would log out every
 *   phone in the middle of a meeting.
 * - A refresh token is ONE USE. Presenting a spent one outside the grace window
 *   revokes the whole family, so concurrent callers share one in-flight refresh
 *   instead of each spending the same token.
 */

import {
  apiSuccessSchema,
  authMessageSchema,
  authSessionSchema,
  authTokenSchema,
} from '@chatofy/types/http';
import {
  SignedOutError,
  type AuthClient,
  type AuthMessage,
  type AuthSession,
  type AuthToken,
} from './auth-client.interface.ts';

/** Where the signed-in session lives between launches. */
export interface SessionStore {
  load(): Promise<AuthSession | null>;
  save(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

/** A request the API refused, with the HTTP status the screens map to a message. */
export class AuthRequestError extends Error {
  readonly status: number;

  constructor(route: string, status: number) {
    super(`${route} answered ${status}`);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

export interface HttpAuthClientOptions {
  baseUrl: string;
  store: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Renew this long before the access token's `expiresAt`, so a token handed to a
 * socket upgrade cannot expire between the read and the handshake.
 */
export const REFRESH_SKEW_MS = 60_000;

/** Bounds every auth request; a hung API must not hang the sign-in button. */
const REQUEST_TIMEOUT_MS = 10_000;

const sessionEnvelope = apiSuccessSchema(authSessionSchema);
const tokenEnvelope = apiSuccessSchema(authTokenSchema);
const messageEnvelope = apiSuccessSchema(authMessageSchema);

type Listener = (session: AuthSession | null) => void;

export class HttpAuthClient implements AuthClient {
  private readonly baseUrl: string;
  private readonly store: SessionStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  /** `undefined` until the store has been read once; `null` when signed out. */
  private session: AuthSession | null | undefined;
  private refreshing: Promise<string> | null = null;

  constructor(options: HttpAuthClientOptions) {
    this.baseUrl = options.baseUrl;
    this.store = options.store;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const res = await this.post('/auth/login', { email, password });
    const session = sessionEnvelope.parse(await res.json()).data;
    await this.setSession(session);
    return session;
  }

  async signUp(email: string, password: string, name: string): Promise<AuthMessage> {
    const res = await this.post('/auth/register', { email, password, name });
    return messageEnvelope.parse(await res.json()).data;
  }

  /**
   * Signs out locally first, then ends the refresh family server-side. The local
   * half is what the user asked for and must not wait on the network; a failed
   * revoke leaves a family that expires on its own.
   */
  async signOut(): Promise<void> {
    const refreshToken = (await this.getSession())?.token.refreshToken;
    await this.setSession(null);
    if (!refreshToken) return;
    try {
      await this.post('/auth/revoke', { refreshToken });
    } catch {
      // Best effort: see above.
    }
  }

  async refreshSession(refreshToken: string): Promise<AuthToken> {
    const res = await this.post('/auth/refresh', { refreshToken });
    return tokenEnvelope.parse(await res.json()).data;
  }

  async getSession(): Promise<AuthSession | null> {
    if (this.session === undefined) {
      try {
        this.session = await this.store.load();
      } catch {
        // An unreadable store is a signed-out device, not a crash at launch.
        this.session = null;
      }
    }
    return this.session;
  }

  async getAccessToken(): Promise<string> {
    const session = await this.getSession();
    if (!session) throw new SignedOutError();
    if (Date.parse(session.token.expiresAt) - REFRESH_SKEW_MS > this.now()) {
      return session.token.accessToken;
    }
    this.refreshing ??= this.renew(session).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  onAuthChange(callback: Listener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private async renew(session: AuthSession): Promise<string> {
    const refreshToken = session.token.refreshToken;
    if (!refreshToken) {
      await this.setSession(null);
      throw new SignedOutError('Session has no refresh token');
    }
    let token: AuthToken;
    try {
      token = await this.refreshSession(refreshToken);
    } catch (err) {
      if (err instanceof AuthRequestError && err.status === 401) {
        await this.setSession(null);
        throw new SignedOutError('Session ended');
      }
      throw err;
    }
    // The grace-window answer may omit the successor; the presented token then stays current.
    await this.setSession({
      user: session.user,
      token: { ...token, refreshToken: token.refreshToken ?? refreshToken },
    });
    return token.accessToken;
  }

  private async setSession(session: AuthSession | null): Promise<void> {
    this.session = session;
    if (session) await this.store.save(session);
    else await this.store.clear();
    for (const listener of this.listeners) listener(session);
  }

  private async post(route: string, body: unknown): Promise<Response> {
    // A controller and a timer, not `AbortSignal.timeout`: Hermes does not ship it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new AuthRequestError(route, res.status);
    return res;
  }
}
