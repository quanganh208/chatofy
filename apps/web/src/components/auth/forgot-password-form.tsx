'use client';

import { useState } from 'react';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { forgotPassword } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';

/**
 * The confirmation text is a fixed string here, not `data.message`.
 *
 * The API already answers a known and an unknown address identically — see
 * `AuthService.forgotPassword` — but this form does not even read that answer,
 * so a future change to what the API sends back cannot leak into this page's
 * wording by accident. What CAN legitimately vary is whether the request
 * completed at all: a network failure or a validation error is not "the API's
 * answer" about the address, it is no answer, and saying so names an oracle for
 * no particular email.
 */
export function ForgotPasswordForm() {
  const t = useTranslate();
  // Used only by the no-account branch, which by construction has no row to read a
  // language from. The found branch reads the column — see `password-reset.service.ts`.
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p id="forgot-success" role="status" className="text-prose">
        {t('web.auth.resetLinkSent')}
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
        forgotPassword({ email, locale })
          .then(() => setSubmitted(true))
          .catch((err: unknown) => {
            setError(authErrorMessage(err, t, 'web.auth.sendResetFailed'));
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">{t('web.auth.email')}</Label>
        <Input
          id="forgot-email"
          type="email"
          required
          maxLength={AUTH_LIMITS.maxEmail}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {error ? (
        <p id="forgot-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

      <Button id="forgot-submit" type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('web.auth.sending') : t('web.auth.sendResetLink')}
      </Button>
    </form>
  );
}
