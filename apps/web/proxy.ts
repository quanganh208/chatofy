import { NextResponse } from 'next/server';
import { auth } from '@/../auth';
import { isLiveSession } from '@/lib/session-guard';

/**
 * Every feature route requires a session.
 *
 * Named `proxy.ts`: Next 16 renamed `middleware.ts`, and the Auth.js docs
 * predate that.
 *
 * This is a redirect, not a security boundary — the API is. It exists so an
 * unauthenticated visitor lands on the sign-in page instead of on a translate
 * surface whose every request 401s and whose socket is refused at the upgrade,
 * which looks like an outage rather than a login prompt.
 *
 * The cookie is only read, never trusted for anything: what a request may
 * actually do is decided by the Nest guard from the bearer token.
 *
 * It tests CREDENTIAL LIVENESS, not cookie presence. Presence alone was the
 * reported bug: a session whose token had died still made `req.auth` truthy, so
 * this waved the user into an app where every request 401s — which reads as an
 * outage rather than as a session that ended.
 */
const guarding = auth((req) => {
  if (isLiveSession(req.auth)) return NextResponse.next();

  // Carried so signing in resumes what they were reaching for rather than
  // dropping them somewhere generic.
  const target = new URL('/login', req.nextUrl.origin);
  target.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(target);
});

/**
 * AWAITED, because under a lazy config `auth(handler)` is a promise.
 *
 * `export default auth((req) => …)` is what next-auth's docs show and what this
 * file used to do — correctly, while `auth.ts` handed NextAuth an object. The
 * lazy config form that `canPersist` requires changes the shape: `initAuth`
 * returns ONE async function that dispatches on its arguments, so calling it
 * with a handler yields `Promise<handler>` rather than the handler. Verified in
 * `next-auth@5.0.0-beta.32`, `lib/index.js` — the wrapper branch does return the
 * middleware, but the outer function it returns from is `async`.
 *
 * Both halves of the failure follow from that promise. Next 16 rejects a proxy
 * whose default export is not a function — "The Proxy file \"/proxy\" must
 * export a function named `proxy` or a default function" — and that rejection
 * fails the whole module, so EVERY route 500s, including the ones the matcher
 * exempts. `/` looked uninvolved and was the reason this read as a global fault
 * rather than a session one.
 *
 * Nothing short of a running production server sees it: `next build` compiles
 * this file happily, typecheck is satisfied because the promise is well typed,
 * and no unit test loads a proxy. The gap it exposes is that CI builds the web
 * image and never starts it — a single request against the built server would
 * have caught this before it reached a deploy.
 *
 * Awaiting the promise here keeps `config(req)` receiving the request, which is
 * what makes middleware a writable path and lets a rotated cookie persist. Do
 * not "simplify" this back to a bare default export.
 */
export default async function proxy(...args: Parameters<Awaited<typeof guarding>>) {
  return (await guarding)(...args);
}

export const config = {
  /**
   * Everything except the routes that must work signed out, plus the assets a
   * redirect would break.
   *
   * `/` is open on purpose — it is the landing page, and gating it would mean a
   * visitor's first sight of the product is a login form. That is what the
   * trailing `.+` buys: with `.*` the pattern also matches the empty remainder,
   * which IS the root, and the landing page redirects to login for everyone.
   * `/api/auth` must be open or signing in could never complete.
   *
   * `register`, `verify-email`, `forgot-password` and `reset-password` are open
   * for the same reason `login` is: a person reaching any of them has, by
   * construction, no session yet.
   *
   * Without this, `/verify-email?token=…` — a link mailed to someone who has never
   * signed in — would redirect here before it ever renders, and worse, the redirect
   * above copies the live token into a `?next=` on the login URL and into browser
   * history along the way.
   *
   * `/locale` is open because the landing page is. It is the language switch, and a
   * signed-out visitor reading the landing page in the wrong language is exactly who
   * needs it — gating it would answer "switch to Vietnamese" with a login form. It
   * carries no credential: two public query values, and the one that is a redirect
   * target is already clamped by `sameOriginPath`.
   */
  matcher: [
    // Anything with a file extension is an asset, matched by shape rather than
    // by listing formats: the earlier `\\.png$` exclusion covered a set this
    // app does not ship — `public/` holds only SVGs — so every one of them got
    // a 307 to /login for a signed-out visitor.
    //
    // Each new route gets the same `name$|name/` pair as `login`: a bare
    // `register` prefix would also exempt `/registersomething`, which is not
    // this route at all.
    '/((?!api/auth|login$|login/|register$|register/|verify-email$|verify-email/|forgot-password$|forgot-password/|reset-password$|reset-password/|locale$|locale/|_next/static|_next/image|worklets|.*\\.[a-zA-Z0-9]+$).+)',
  ],
};
