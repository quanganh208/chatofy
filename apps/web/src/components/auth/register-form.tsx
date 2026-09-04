'use client';

import { useState } from 'react';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { AuthAlert } from '@/components/auth/auth-alert';
import { AuthField } from '@/components/auth/auth-field';
import { register } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';

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
  // Carried on the request because no row exists yet to store it on — the row is
  // what redeeming the mailed link creates, and the verification mail goes out
  // before that. It is persisted with the row, so every later mail reads the column.
  const locale = useLocale();
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
        register({ email, password, name, locale })
          .then(() => setSubmitted(true))
          .catch((err: unknown) => {
            setError(authErrorMessage(err, t, 'web.auth.createFailed'));
          })
          .finally(() => setSubmitting(false));
      }}
    >
      {/* Every input carries the flag, not just the rejected one. The API does say
          which field it refused — `apiErrorSchema` has `details[].path`, filled in
          by the exceptions filter — but `authErrorMessage` reduces the whole error
          to one string, so nothing here knows. Flagging all of them is the honest
          reading of "something in this form was rejected"; attributing the right
          field means changing what `authErrorMessage` returns, which is a larger
          change than this one and was deliberately not taken. */}
      <AuthField
        id="register-name"
        label={t('web.auth.name')}
        errorId={error ? 'register-error' : undefined}
        type="text"
        required
        minLength={AUTH_LIMITS.minName}
        maxLength={AUTH_LIMITS.maxName}
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <AuthField
        id="register-email"
        label={t('web.auth.email')}
        errorId={error ? 'register-error' : undefined}
        type="email"
        required
        maxLength={AUTH_LIMITS.maxEmail}
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <AuthField
        id="register-password"
        label={t('web.auth.password')}
        errorId={error ? 'register-error' : undefined}
        type="password"
        required
        minLength={AUTH_LIMITS.minPassword}
        maxLength={AUTH_LIMITS.maxPassword}
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <AuthAlert id="register-error" message={error} />

      <Button id="register-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('web.auth.creatingAccount') : t('web.auth.createAccount')}
      </Button>
    </form>
  );
}
