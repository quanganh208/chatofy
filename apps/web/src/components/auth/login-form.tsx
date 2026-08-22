'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button, Label } from '@chatofy/ui/react';

const FIELD =
  'border-hairline bg-background text-body focus-visible:ring-ring w-full rounded-md border px-3 py-2 outline-none focus-visible:ring-2';

/**
 * Email and password, terminating at the Nest API through the Credentials
 * provider.
 *
 * `redirect: false` so the failure is rendered here rather than bounced through
 * Auth.js's own error page, which would drop whatever the user was trying to
 * reach. The message is deliberately generic: the API answers a wrong password
 * and an unknown email identically, and saying more here would undo that.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Where the gate turned them away from, so signing in resumes what they were
  // doing instead of dropping them on the home page.
  const next = params.get('next') ?? '/translate';

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(undefined);
        void signIn('credentials', { email, password, redirect: false }).then((result) => {
          setSubmitting(false);
          if (result?.error) {
            setError('That email and password did not match an account.');
            return;
          }
          // `refresh` before navigating: the server components behind the gate
          // read the session, and without it they render from a cache taken
          // while the user was signed out.
          router.refresh();
          router.push(next as Parameters<typeof router.push>[0]);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          className={FIELD}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          className={FIELD}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? (
        <p id="login-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="login-submit" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
