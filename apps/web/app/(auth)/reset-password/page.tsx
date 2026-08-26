import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@chatofy/ui/react';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.resetPassword') };
}

// `ResetPasswordForm` reads `useSearchParams` for the token, so it needs the
// same `Suspense` boundary `/login` uses for the same reason.
export default async function ResetPasswordPage() {
  const t = await getT();

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">
          {t('web.auth.resetPasswordHeading')}
        </h1>
        <p className="text-muted-foreground text-prose">{t('web.auth.chooseNewPassword')}</p>
      </div>

      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </Suspense>

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
