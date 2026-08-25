'use client';

import { useState } from 'react';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { register } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';

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
  const t = useTranslate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p id="register-success" role="status" className="text-prose">
        {t('web.auth.checkYourEmail')}
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
            setError(authErrorMessage(err, t, 'web.auth.createFailed'));
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-name">{t('web.auth.name')}</Label>
        <Input
          id="register-name"
          type="text"
          required
          minLength={AUTH_LIMITS.minName}
          maxLength={AUTH_LIMITS.maxName}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-email">{t('web.auth.email')}</Label>
        <Input
          id="register-email"
          type="email"
          required
          maxLength={AUTH_LIMITS.maxEmail}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-password">{t('web.auth.password')}</Label>
        <Input
          id="register-password"
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
        <p id="register-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="register-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('web.auth.creatingAccount') : t('web.auth.createAccount')}
      </Button>
    </form>
  );
}
