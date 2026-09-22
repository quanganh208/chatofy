import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLink } from '@/components/auth/auth-link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { AuthDivider } from '@/components/auth/auth-divider';
import { LoginForm } from '@/components/auth/login-form';
import { googleConfigured } from '@/config/server-env';
import { DEFAULT_NEXT } from '@/lib/same-origin-path';
import type { MessageKey } from '@chatofy/i18n';
import { getT } from '@/i18n/server';
import { isLiveSession } from '@/lib/session-guard';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.signIn') };
}

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
const SIGN_IN_ERRORS = {
  google: 'web.auth.googleRefused',
  server: 'web.auth.signInUnavailable',
} as const satisfies Record<string, MessageKey>;

/**
 * What `?verified=1` and `?reset=1` mean to the person reading them.
 *
 * Same shape as `SIGN_IN_ERRORS` just above, and the same reason: both arrive
 * here after a real action completed on another page — a redeemed
 * verification link, a completed reset — and landing back on a bare form with
 * no account of what just happened reads as that action having silently
 * failed, exactly like an unanswered `?error=` value does above.
 */
const SIGN_IN_NOTICES = {
  verified: 'web.auth.noticeVerified',
  reset: 'web.auth.noticeReset',
} as const satisfies Record<string, MessageKey>;

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
  // The PREDICATE, not truthiness. Redirecting on cookie presence alone is what
  // closes the loop: a dead-but-cookied session sent here by the route guard
  // would be sent straight back to a gated route, and back again, forever.
  if (isLiveSession(await auth())) redirect(DEFAULT_NEXT);

  const { error, verified, reset } = await searchParams;
  const t = await getT();
  // `hasOwn`, not a bare index: `error` comes straight off the query string, and
  // a plain lookup would answer `?error=toString` with a function off the
  // prototype chain — which React then tries to render.
  const errorKey =
    error !== undefined && Object.hasOwn(SIGN_IN_ERRORS, error)
      ? SIGN_IN_ERRORS[error as keyof typeof SIGN_IN_ERRORS]
      : undefined;

  // Two flags rather than one enum value, because two different pages set
  // them independently — but the lookup carries the same `hasOwn` guard as
  // `errorMessage` above, so this table stays as safe to extend as that one is
  // if a future key ever stops being a literal chosen by this file.
  const notice = verified === '1' ? 'verified' : reset === '1' ? 'reset' : undefined;
  const noticeKey =
    notice !== undefined && Object.hasOwn(SIGN_IN_NOTICES, notice)
      ? SIGN_IN_NOTICES[notice]
      : undefined;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-display font-light tracking-tight">
          {t('web.auth.signIn')}
        </h1>
        <p className="text-muted-foreground text-prose">{t('web.auth.accountRequired')}</p>
      </div>

      {errorKey ? (
        <p role="alert" className="text-destructive text-prose">
          {t(errorKey)}
        </p>
      ) : null}

      {/* Independent of `errorMessage`: nothing on this route can produce
          both an `?error=` and a `?verified=`/`?reset=` at once, but nothing
          here assumes that either — each renders only from its own value. */}
      {noticeKey ? (
        <p role="status" className="text-prose">
          {t(noticeKey)}
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
            {googleConfigured ? <AuthDivider label={t('web.auth.orContinueWithEmail')} /> : null}
            <LoginForm />
            <div className="text-hint flex items-center justify-between gap-4">
              <AuthLink href="/forgot-password">{t('web.auth.forgotPasswordShort')}</AuthLink>
              <AuthLink href="/register">{t('web.auth.createAccountHeading')}</AuthLink>
            </div>
          </CardContent>
        </Card>
      </Suspense>
    </>
  );
}
