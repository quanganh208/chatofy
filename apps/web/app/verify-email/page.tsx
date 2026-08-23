import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Card, CardContent } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';
import { VerifyEmailClient } from '@/components/auth/verify-email-client';

export const metadata: Metadata = { title: 'Verify email · Chatofy' };

/**
 * No signed-in redirect: reaching this page needs a mailed token, not a
 * session, and someone verifying a second email on an already-signed-in device
 * is not a case worth turning away.
 *
 * `VerifyEmailClient` reads `useSearchParams`, so it needs the same `Suspense`
 * boundary `/login` uses for the same reason — see that page's comment on what
 * the boundary buys and what it does not.
 */
export default function VerifyEmailPage() {
  return (
    <AppShell measure="reading">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">Verify your email</h1>
      </div>

      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <VerifyEmailClient />
          </CardContent>
        </Card>
      </Suspense>
    </AppShell>
  );
}
