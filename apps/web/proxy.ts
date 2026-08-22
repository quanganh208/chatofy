import { NextResponse } from 'next/server';
import { auth } from '@/../auth';

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
 */
export default auth((req) => {
  if (req.auth) return NextResponse.next();

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
   */
  matcher: [
    // Anything with a file extension is an asset, matched by shape rather than
    // by listing formats: the earlier `\\.png$` exclusion covered a set this
    // app does not ship — `public/` holds only SVGs — so every one of them got
    // a 307 to /login for a signed-out visitor.
    '/((?!api/auth|login$|login/|_next/static|_next/image|worklets|.*\\.[a-zA-Z0-9]+$).+)',
  ],
};
