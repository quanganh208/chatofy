import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@chatofy/ui/react';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password · Chatofy' };

// No `Suspense` boundary: unlike the other three auth pages, nothing under
// this one calls `useSearchParams` — the form only ever collects an email and
// posts it.
export default function ForgotPasswordPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-muted-foreground text-prose">
          Enter the email on your account and we&apos;ll send a link to reset it.
        </p>
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
          Back to sign in
        </Link>
      </p>
    </>
  );
}
