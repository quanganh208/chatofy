'use client';

import { useState } from 'react';
import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';
import { Button, Input, Label } from '@chatofy/ui/react';
import { register } from '@/clients/api-client';

/**
 * Begins registration only — it does not finish it.
 *
 * No account exists until the mailed link is redeemed at `/verify-email`, so
 * there is nothing here to sign in to: an auto sign-in on 202 would be signing
 * in an account that does not exist yet. On success the form is replaced by a
 * fixed "check your email" notice rather than the API's own message, for the
 * same reason `ForgotPasswordForm` does that — the API answers a fresh address
 * and an already-registered one identically (`AuthService.register`), and a
 * form that read the response body still could not vary its wording even if it
 * wanted to, which is the point.
 */
export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p id="register-success" role="status" className="text-prose">
        Check your email for a link to finish creating your account.
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
        register({ email, password, name })
          .then(() => setSubmitted(true))
          .catch((err: unknown) => {
            if (err instanceof ApiClientError) setError(err.error.message);
            else if (err instanceof ContractError) setError('Unexpected response from the server.');
            else if (err instanceof NetworkError)
              setError(
                err.timedOut ? 'That took too long — try again.' : 'Cannot reach the server.',
              );
            else setError('Could not create the account. Try again.');
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-name">Name</Label>
        <Input
          id="register-name"
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-password">Password</Label>
        <Input
          id="register-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? (
        <p id="register-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="register-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
