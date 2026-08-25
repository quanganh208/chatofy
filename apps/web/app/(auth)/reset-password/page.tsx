import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Card, CardContent } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Reset password · Chatofy' };

// `ResetPasswordForm` reads `useSearchParams` for the token, so it needs the
// same `Suspense` boundary `/login` uses for the same reason.
export default function ResetPasswordPage() {
  return (
    <AppShell measure="reading" back={{ href: '/login', label: 'Back to sign in' }}>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground text-prose">Choose a new password for your account.</p>
      </div>

      <Suspense fallback={null}>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </Suspense>
    </AppShell>
  );
}
