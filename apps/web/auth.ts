import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import type { AuthSession } from '@chatofy/types';
import { env } from '@/config/env';
import { googleConfigured, serverEnv } from '@/config/server-env';

/**
 * NextAuth as a thin session shell over the Nest API.
 *
 * Pinned to an exact beta, and the exact one matters: 5.0.0-beta.0 through
 * beta.31 carry two critical advisories (a config error that makes
 * existence-based auth checks fail OPEN, and a homoglyph bypass in the email
 * normalizer) plus a high one. beta.32 is the first release outside those
 * ranges and the first to depend on the patched @auth/core 0.41.3. There is no
 * 5.0.0 stable — `latest` is still v4 — so "upgrade to the fixed version" means
 * this pin. Check the advisory ranges before moving it.
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

/** What the API said: a session, or why there is not one. */
type ApiResult = { session: AuthSession } | { session: null; serverFault: boolean };

async function postToApi(path: string, body: unknown): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // The API is unreachable. Nothing about the user's credentials.
    return { session: null, serverFault: true };
  }

  const envelope = (await res.json().catch(() => null)) as ApiEnvelope | null;
  if (!res.ok || !envelope?.data?.token?.accessToken) {
    // The status is the only thing that survives the API's error filter, which
    // genericises every 5xx body so internals cannot leak. A 5xx here means the
    // server — most likely Google login not configured, which answers 501 — and
    // must not be reported as a problem with the user's account.
    return { session: null, serverFault: res.status >= 500 };
  }
  return { session: envelope.data };
}

/**
 * Re-reads this account's avatar URL from the API.
 *
 * Returns the URL or null on a clean read, and `undefined` when the read itself
 * failed — the caller distinguishes them, because clearing a picture over a
 * transient network error would look like a removal nobody asked for.
 */
async function fetchAvatarUrl(accessToken: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      // Bounded, because this runs INSIDE the jwt callback: an unbounded read
      // against a hung API stalls /api/auth/session, so `update()` never
      // resolves and the caller's pending state never clears. Node's default
      // would let that run for minutes. The avatar is decorative — five seconds
      // is already longer than it is worth waiting for.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const envelope = (await res.json()) as { data?: { avatarUrl?: string | null } };
    return envelope.data?.avatarUrl ?? null;
  } catch {
    return undefined;
  }
}

// `signIn`/`signOut` are deliberately not destructured: every caller in this app
// imports them from `next-auth/react`, and re-exporting the server-side pair here
// would offer a second way to do the same thing.
export const { handlers, auth } = NextAuth({
  secret: serverEnv.AUTH_SECRET,
  /**
   * Required off Vercel. Auth.js refuses to build callback URLs from a Host
   * header it has not been told to trust, and every route — including
   * `/api/auth/session` — fails with UntrustedHost until this is set or AUTH_URL
   * names the origin outright.
   *
   * Trusting the header means trusting whatever terminates TLS in front of this
   * app to set it correctly, which is the normal arrangement for a reverse proxy
   * you operate. If this is ever exposed to a proxy you do not control, set
   * AUTH_URL to the canonical origin instead and drop this.
   */
  trustHost: true,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    // Offered only when BOTH halves are configured. Auth.js's own
    // GET /api/auth/providers then reports exactly this list, which is what the
    // login page reads — so the button cannot appear without a working flow
    // behind it.
    ...(googleConfigured
      ? [
          Google({
            clientId: serverEnv.AUTH_GOOGLE_ID!,
            clientSecret: serverEnv.AUTH_GOOGLE_SECRET!,
          }),
        ]
      : []),
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

        const result = await postToApi('/auth/login', { email, password });
        if (!result.session) return null;

        return {
          id: result.session.user.id,
          email: result.session.user.email,
          name: result.session.user.name,
          // The API's composed avatar URL, or null. `image` is already on
          // Auth.js's user shape, so this needs no module augmentation.
          image: result.session.user.avatarUrl,
          accessToken: result.session.token.accessToken,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Exchange Google's id_token for a Nest session, server-side.
     *
     * The browser never posts the id_token to the API and never sees a decision
     * made from a payload it could have written: Auth.js completes the OAuth
     * dance, and this hands `account.id_token` to POST /auth/google, which
     * verifies it against Google's JWKS.
     *
     * A refusal is a redirect rather than a silent `false`, because the most
     * likely refusal is not a broken token — it is the linking policy declining
     * to attach Google to an account that already has a password, and the user
     * needs to be told to sign in with that password instead.
     *
     * `user` is mutated rather than returned: it is the same object the `jwt`
     * callback receives on this pass, which is how the token reaches the cookie.
     */
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;

      const idToken = account.id_token;
      if (typeof idToken !== 'string') return '/login?error=google';

      const result = await postToApi('/auth/google', { idToken });
      if (!result.session) {
        // Told apart because the two need different words. A refusal is about
        // this account — most often the linking policy declining to attach
        // Google to one that already has a password. A 5xx is about the server,
        // and blaming the user's account for it sends them looking for a
        // problem that is not theirs.
        return result.serverFault ? '/login?error=server' : '/login?error=google';
      }

      user.accessToken = result.session.token.accessToken;
      user.id = result.session.user.id;
      // UNCONDITIONAL, including null — do NOT guard on truthiness.
      //
      // The built-in Google provider's default `profile()` has ALREADY put an
      // lh3.googleusercontent.com URL in `user.image`, before this callback
      // runs. A conditional copy leaves that URL in place for exactly the users
      // whose import failed, and `img-src` names only the R2 origin — so every
      // authenticated page would then request a blocked image. The wrong repair
      // is adding googleusercontent.com to img-src: that turns every page view
      // into a Google-visible request from an authenticated session.
      user.image = result.session.user.avatarUrl;
      return true;
    },

    /**
     * Carry the API's token into the session cookie.
     *
     * `user` is present only on the sign-in pass; every later call re-reads the
     * same token off the existing cookie rather than minting anything.
     */
    async jwt({ token, user, trigger }) {
      if (user && 'accessToken' in user) {
        token.accessToken = user.accessToken as string;
        // Seeded from the API's value on the sign-in pass. Explicitly `?? null`
        // rather than left alone: @auth/core populates `token.picture` from
        // `user.image` before this runs, so for a Google sign-in there is
        // already a value here that has to be overwritten, not merely set.
        token.picture = user.image ?? null;
      }

      // `useSession().update(data)` POSTs `data` from the BROWSER and it arrives
      // here. Writing it into the signed cookie would let any script — and
      // `next.config.ts` concedes that `script-src` still carries
      // 'unsafe-inline', so injected inline script runs — persist an arbitrary
      // image URL for the session's full lifetime. So the payload is ignored
      // entirely and the value is re-read from the API instead: the client's
      // role is to say SOMETHING CHANGED, never to say what it changed to.
      if (trigger === 'update' && typeof token.accessToken === 'string') {
        const refreshed = await fetchAvatarUrl(token.accessToken);
        // `undefined` means the read itself failed; leave the token as it was
        // rather than clearing a picture over a transient error.
        if (refreshed !== undefined) token.picture = refreshed;
      }
      return token;
    },
    /**
     * Expose the token to the app.
     *
     * Readable from client JS by design: `getHeaders` on the api client and the
     * WebSocket handshake both need it, and neither runs on the server. The
     * trade-off is recorded rather than hidden — an XSS that can read this can
     * exfiltrate a bearer credential valid for up to seven days from any host.
     * The CSP in next.config.ts narrows where that credential can be SENT; it
     * does not stop the script that reads it, because `script-src` still carries
     * `'unsafe-inline'`. Read the note there before treating it as a control.
     */
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      if (session.user && typeof token.sub === 'string') session.user.id = token.sub;
      // From the token, which only ever carries a value this app read from the
      // API. @auth/core would otherwise build this from `token.picture` on its
      // own; being explicit keeps the one source of truth visible here.
      if (session.user) session.user.image = (token.picture as string | null) ?? null;
      return session;
    },
  },
});
