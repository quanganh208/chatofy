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
export default auth((req) => {
  if (isLiveSession(req.auth)) return NextResponse.next();

  // Carried so signing in resumes what they were reaching for rather than
  // dropping them somewhere generic.
  const target = new URL('/login', req.nextUrl.origin);
  target.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(target);
});

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
