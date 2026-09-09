import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLink } from '@/components/auth/auth-link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { AuthDivider } from '@/components/auth/auth-divider';
import { RegisterForm } from '@/components/auth/register-form';
import { googleConfigured } from '@/config/server-env';
import { DEFAULT_NEXT } from '@/lib/same-origin-path';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.register') };
}

/**
 * Mirrors `/login`'s structure exactly: same signed-in redirect, same
 * `googleConfigured` gate, same `Suspense` shape — see `app/login/page.tsx` for
 * why each piece is shaped the way it is. Both pages decide the same thing
 * (whether Google sign-in can work at all) from the same server-side fact, so
 * inventing a second shape here would only be a second place for that decision
 * to drift out of sync with the first.
 */
export default async function RegisterPage() {
  const t = await getT();

  // Already signed in: an account already exists for this session, and
  // registering again would ask the API to begin a flow that ends where this
  // person already is.
  if (await auth()) redirect(DEFAULT_NEXT);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">
          {t('web.auth.createAccountHeading')}
        </h1>
        <p className="text-muted-foreground text-prose">{t('web.auth.accountRequired')}</p>
      </div>

      {/* See `app/login/page.tsx`'s comment on this same boundary. Here only
          `GoogleButton` calls `useSearchParams` — `RegisterForm` does not — but one
          child needing it is what makes the boundary required. */}
      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
            {googleConfigured ? <AuthDivider label={t('web.auth.orContinueWithEmail')} /> : null}
            <RegisterForm />
          </CardContent>
        </Card>
      </Suspense>

      {/* Under the form rather than in a header corner, which is where the old shell put
          it. This is the alternative to the form above it, so it belongs next to the
          form — and the auth layout can no longer carry it anyway: each of these routes
          wants a different return link, and a layout receives nothing from its page. */}
      <p className="text-hint text-center">
        <AuthLink href="/login">
          {t('web.auth.haveAccountPrompt')} {t('web.auth.signIn')}
        </AuthLink>
      </p>
    </>
  );
}
