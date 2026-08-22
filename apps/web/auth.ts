import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { AuthSession } from '@chatofy/types';
import { env } from '@/config/env';
import { serverEnv } from '@/config/server-env';

/**
 * NextAuth as a thin session shell over the Nest API.
 *
 * The API is the identity authority: it hashes passwords, verifies Google
 * id_tokens and signs the access token every client carries. Nothing here
 * touches a database — `strategy: 'jwt'` with no adapter, so DATABASE_URL never
 * needs to exist in this app. What this file owns is one cookie and two
 * callbacks, which is what keeps replacing Auth.js later from reaching Nest or
 * the shared contracts at all.
 */

/**
 * Seven days, matching the Nest token exactly.
 *
 * Auth.js sessions slide by default — 30 days, refreshed every 24 hours — while
 * the Nest token has a fixed lifetime. Left alone the cookie outlives the token
 * and the user looks signed in while every request 401s, which is
 * indistinguishable from an outage. There is no refresh flow to bridge the gap,
 * so the two lifetimes have to be one number.
 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** What the API returns from /auth/login and /auth/google. */
type ApiEnvelope = {
  success?: boolean;
  data?: AuthSession;
  error?: { message?: string };
};

async function postToApi(path: string, body: unknown): Promise<AuthSession | null> {
  const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json().catch(() => null)) as ApiEnvelope | null;
  if (!res.ok || !envelope?.data?.token?.accessToken) return null;
  return envelope.data;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: serverEnv.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      /**
       * Terminates at POST /auth/login. Returning null is how Auth.js reports a
       * failed sign-in; the API answers a wrong password and an unknown email
       * identically, and this does not add a distinction it withheld.
       */
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        const session = await postToApi('/auth/login', { email, password });
        if (!session) return null;

        return {
          id: session.user.id,
          email: session.user.email,
          name: session.user.displayName,
          accessToken: session.token.accessToken,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Carry the API's token into the session cookie.
     *
     * `user` is present only on the sign-in pass; every later call re-reads the
     * same token off the existing cookie rather than minting anything.
     */
    jwt({ token, user }) {
      if (user && 'accessToken' in user) {
        token.accessToken = user.accessToken as string;
      }
      return token;
    },
    /**
     * Expose the token to the app.
     *
     * Readable from client JS by design: `getHeaders` on the api client and the
     * WebSocket handshake both need it, and neither runs on the server. The
     * trade-off is recorded rather than hidden — an XSS that can read this can
     * exfiltrate a bearer credential valid for up to seven days from any host,
     * which is what the CSP in next.config.ts exists to make harder.
     */
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      if (session.user && typeof token.sub === 'string') session.user.id = token.sub;
      return session;
    },
  },
});
