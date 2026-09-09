import 'next-auth';
import 'next-auth/jwt';

/**
 * The Nest access token, carried through the session.
 *
 * Declared here rather than cast at each read: `session.accessToken` is what the
 * api client and both WebSocket transports consume, and an untyped read would
 * make a rename in `auth.ts` a runtime failure at connect time instead of a
 * build error.
 */
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    /**
     * Set when renewal has TERMINALLY failed, and the one signal every
     * session-gating site reads through `isLiveSession`.
     *
     * Deliberately not a reason code. A caller only ever needs to know whether
     * to keep going or to sign out, and a taxonomy here would invite branches
     * that treat some terminal failures as recoverable.
     */
    error?: 'RefreshTokenError';
  }
  interface User {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch SECONDS. The API sends an ISO string; it is converted once, at the boundary. */
    expiresAt?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    /**
     * Never copied into `Session`. It stays inside the httpOnly JWE cookie,
     * where client JS cannot read it — unlike `accessToken`, which the api
     * client and the WebSocket handshake both need in the browser.
     */
    refreshToken?: string;
    /** Epoch SECONDS — see `User.expiresAt`. */
    expiresAt?: number;
    error?: 'RefreshTokenError';
  }
}
