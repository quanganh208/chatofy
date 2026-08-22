import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/../auth';
import { AppShell } from '@/components/layout/app-shell';
import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { googleConfigured } from '@/config/server-env';

export const metadata: Metadata = { title: 'Sign in · Chatofy' };

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
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  // Already signed in: nothing here applies, and leaving the form up invites
  // someone to sign in a second time to reach a page they can already open.
  if (await auth()) redirect('/translate');

  const { error } = await searchParams;

  return (
    <AppShell measure="reading">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-prose">
          Translating needs an account — every session and transcript belongs to one.
        </p>
      </div>

      {error === 'google' ? (
        <p role="alert" className="text-destructive text-prose">
          That Google account could not be used to sign in. If you already have a password for this
          email, sign in with it below.
        </p>
      ) : null}

      {/* `useSearchParams` in both children needs a boundary; without one the
          whole route opts out of static rendering. */}
      <Suspense fallback={null}>
        <div className="flex flex-col gap-4">
          {googleConfigured ? <GoogleButton /> : null}
          <LoginForm />
        </div>
      </Suspense>
    </AppShell>
  );
}
