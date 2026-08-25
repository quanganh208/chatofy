import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@chatofy/ui/react';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.forgotPassword') };
}

// No `Suspense` boundary: unlike the other three auth pages, nothing under
// this one calls `useSearchParams` — the form only ever collects an email and
// posts it.
export default async function ForgotPasswordPage() {
  const t = await getT();

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">
          {t('web.auth.forgotPasswordLink')}
        </h1>
        <p className="text-muted-foreground text-prose">{t('web.auth.forgotPasswordBody')}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <ForgotPasswordForm />
        </CardContent>
      </Card>

      <p className="text-center">
        <Link
          href="/login"
          className="text-hint hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          {t('web.auth.backToSignIn')}
        </Link>
      </p>
    </>
  );
}
