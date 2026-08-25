import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { googleConfigured } from '@/config/server-env';

export const metadata: Metadata = { title: 'Sign in · Chatofy' };

/**
 * What each `?error=` value on this route means to the person reading it.
 *
 * `auth.ts` tells a refusal about THIS ACCOUNT apart from a fault on the server
 * — most often Google login not being configured, which answers 501 — precisely
 * so the two can be worded differently. A value it can produce and this table
 * does not answer returns the user to a bare form with no account of why they
 * are looking at it again, which reads as the sign-in having silently failed.
 * So the two live together here rather than as one inline comparison.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  google:
    'That Google account could not be used to sign in. If you already have a password for this email, sign in with it below.',
  server:
    'Sign-in is unavailable right now — that is a problem on our side, not with your account. Try again shortly, or sign in with your password below.',
};

/**
 * What `?verified=1` and `?reset=1` mean to the person reading them.
 *
 * Same shape as `SIGN_IN_ERRORS` just above, and the same reason: both arrive
 * here after a real action completed on another page — a redeemed
 * verification link, a completed reset — and landing back on a bare form with
 * no account of what just happened reads as that action having silently
 * failed, exactly like an unanswered `?error=` value does above.
 */
const SIGN_IN_NOTICES: Record<string, string> = {
  verified: 'Your account is ready. Sign in below to get started.',
  reset: 'Your password has been changed. Sign in with your new password.',
};

/**
 * The one unauthenticated surface.
 *
 * Whether the Google button renders is decided here, on the server, from this
 * app's own configuration — the same fact Auth.js reports through
 * `GET /api/auth/providers`. The API could never be authoritative for it: the
 * button works only if THIS app holds a Google client id and secret, which the
 * API cannot see, so asking it would give a button that errors or a hidden one
 * that would have worked.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; verified?: string; reset?: string }>;
}) {
  // Already signed in: nothing here applies, and leaving the form up invites
  // someone to sign in a second time to reach a page they can already open.
  if (await auth()) redirect('/translate');

  const { error, verified, reset } = await searchParams;
  // `hasOwn`, not a bare index: `error` comes straight off the query string, and
  // a plain lookup would answer `?error=toString` with a function off the
  // prototype chain — which React then tries to render.
  const errorMessage =
    error !== undefined && Object.hasOwn(SIGN_IN_ERRORS, error) ? SIGN_IN_ERRORS[error] : undefined;

  // Two flags rather than one enum value, because two different pages set
  // them independently — but the lookup carries the same `hasOwn` guard as
  // `errorMessage` above, so this table stays as safe to extend as that one is
  // if a future key ever stops being a literal chosen by this file.
  const noticeKey = verified === '1' ? 'verified' : reset === '1' ? 'reset' : undefined;
  const noticeMessage =
    noticeKey !== undefined && Object.hasOwn(SIGN_IN_NOTICES, noticeKey)
      ? SIGN_IN_NOTICES[noticeKey]
      : undefined;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-prose">
          Translating needs an account — every session and transcript belongs to one.
        </p>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-destructive text-prose">
          {errorMessage}
        </p>
      ) : null}

      {/* Independent of `errorMessage`: nothing on this route can produce
          both an `?error=` and a `?verified=`/`?reset=` at once, but nothing
          here assumes that either — each renders only from its own value. */}
      {noticeMessage ? (
        <p role="status" className="text-prose">
          {noticeMessage}
        </p>
      ) : null}

      {/* `useSearchParams` in both children needs a boundary, and both of them
          have to sit inside it — which is why the Card is in here rather than
          wrapping the Suspense.

          Stated precisely, because the version of this note that said the
          boundary is what keeps the route static was wrong: `await auth()` above
          reads the session cookie, so this route is server-rendered on demand
          today and was before any of this. Measured in `next build` — `ƒ /login`
          — not assumed. What the boundary does is keep the page BUILDABLE the
          moment that stops being true: Next fails a static render that reaches
          `useSearchParams` with no boundary above it, and if the signed-in check
          ever moves to middleware, this route becomes static and that failure
          arrives with it. `login-page.spec.tsx` holds the structure. */}
      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
            {/* Both halves gated on the same server-side fact.

                Rendering a fixed two-route layout would put "or continue with
                email" — and a Google button — on a deployment with no
                AUTH_GOOGLE_ID, which is the "button that errors" outcome this
                file warns about twice. The separator is not decoration here: it
                is the second half of a choice that only exists when there are
                two routes to choose between. */}
            {googleConfigured ? (
              <>
                <GoogleButton />
                <div className="flex items-center gap-3" aria-hidden>
                  <span className="bg-border h-px flex-1" />
                  <span className="text-muted-foreground text-hint">or continue with email</span>
                  <span className="bg-border h-px flex-1" />
                </div>
              </>
            ) : null}
            <LoginForm />
            <div className="text-hint flex items-center justify-between gap-4">
              <Link
                href="/forgot-password"
                className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                Forgot password?
              </Link>
              <Link
                href="/register"
                className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                Create an account
              </Link>
            </div>
          </CardContent>
        </Card>
      </Suspense>
    </>
  );
}
