'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { sameOriginPath } from '@/lib/same-origin-path';

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
  //
  // Clamped, because this value is attacker-controlled: it arrives in the query
  // string of a link anyone can send. It used to flow straight into
  // `router.push(next as …)`, where the cast silenced the type system's only
  // objection — so `?next=https://evil.example` landed a just-authenticated user
  // on someone else's origin. The Google path never had this hole: Auth.js
  // applies its own same-origin clamp to `redirectTo`, and `auth.ts` declares no
  // `redirect` callback to weaken it. Only the credentials path was unguarded.
  const next = sameOriginPath(params.get('next'));

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
          router.push(next);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          maxLength={AUTH_LIMITS.maxEmail}
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          maxLength={AUTH_LIMITS.maxPassword}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? (
        <p id="login-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="login-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
