import { handlers } from '@/../auth';

/**
 * Auth.js's own routes: sign-in, sign-out, callback, session, providers.
 *
 * `GET /api/auth/providers` is served from here, and it — not the Nest API — is
 * what tells the login page whether a Google button can work. Whether Google
 * login is possible on web depends on this app's client id AND secret, which
 * the API cannot see.
 */
export const { GET, POST } = handlers;
