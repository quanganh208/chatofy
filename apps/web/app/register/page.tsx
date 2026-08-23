import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { AppShell } from '@/components/layout/app-shell';
import { GoogleButton } from '@/components/auth/google-button';
import { RegisterForm } from '@/components/auth/register-form';
import { googleConfigured } from '@/config/server-env';

export const metadata: Metadata = { title: 'Create account · Chatofy' };

/**
 * Mirrors `/login`'s structure exactly: same signed-in redirect, same
 * `googleConfigured` gate, same `Suspense` shape — see `app/login/page.tsx` for
 * why each piece is shaped the way it is. Both pages decide the same thing
 * (whether Google sign-in can work at all) from the same server-side fact, so
 * inventing a second shape here would only be a second place for that decision
 * to drift out of sync with the first.
 */
export default async function RegisterPage() {
  // Already signed in: an account already exists for this session, and
  // registering again would ask the API to begin a flow that ends where this
  // person already is.
  if (await auth()) redirect('/translate');

  return (
    <AppShell
      measure="reading"
      back={{ href: '/login', label: 'Already have an account? Sign in' }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">Create an account</h1>
        <p className="text-muted-foreground text-prose">
          Translating needs an account — every session and transcript belongs to one.
        </p>
      </div>

      {/* See `app/login/page.tsx`'s comment on this same boundary: both children
          call `useSearchParams`, and both must sit inside it. */}
      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
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
            <RegisterForm />
          </CardContent>
        </Card>
      </Suspense>
    </AppShell>
  );
}
