'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { resetPassword } from '@/clients/api-client';

/**
 * The reset link's token, read once into state rather than re-read from
 * `location.search` on every render.
 *
 * `useState(() => params.get('token'))` — the initializer form — runs exactly
 * once, on mount, before the effect below strips the query string. A bare
 * `params.get('token')` read at render time would keep working today only
 * because nothing else in this component re-renders around it; moving the read
 * into state makes that independence explicit rather than incidental.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token] = useState(() => params.get('token'));
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Browser history on shared machines: strip the token from the URL bar the
  // moment there is a copy of it safely in state, rather than leaving it in
  // `location.search` — and therefore in history — for as long as this page
  // stays open.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (!token) {
    return (
      <p role="alert" className="text-destructive text-prose">
        That link is missing its reset code.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(undefined);
        resetPassword({ token, password })
          .then(() => {
            // No `finally` resetting `submitting`: this form is about to be
            // replaced by the login page, and re-enabling it mid-navigation
            // would only invite a second submit of an already-spent token.
            router.push('/login?reset=1');
          })
          .catch((err: unknown) => {
            setSubmitting(false);
            setError(authErrorMessage(err, 'Could not reset the password. Try again.'));
          });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          type="password"
          required
          minLength={AUTH_LIMITS.minPassword}
          maxLength={AUTH_LIMITS.maxPassword}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? (
        <p id="reset-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="reset-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Resetting…' : 'Reset password'}
      </Button>
    </form>
  );
}
