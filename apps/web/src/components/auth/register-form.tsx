'use client';

import { useState } from 'react';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { AuthAlert } from '@/components/auth/auth-alert';
import { AuthField } from '@/components/auth/auth-field';
import { SubmittedNotice } from '@/components/auth/submitted-notice';
import { register } from '@/clients/api-client';
import { useSubmittedNotice } from '@/hooks/use-submitted-notice';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formText } from '@/lib/form-text';

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
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { submitted, setSubmitted, notice } = useSubmittedNotice();

  return (
    <>
      <SubmittedNotice
        id="register-success"
        submitted={submitted}
        message={t('web.auth.checkYourEmail')}
        ref={notice}
      />

      {submitted ? null : (
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            // Read from the form, not React state — see `login-form.tsx`: a value typed or
            // autofilled before hydration is only in the DOM, and the submit sent it empty.
            const form = new FormData(event.currentTarget);
            const name = formText(form, 'name');
            const email = formText(form, 'email');
            const password = formText(form, 'password');
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
            name="name"
          />

          <AuthField
            id="register-email"
            label={t('common.auth.email')}
            errorId={error ? 'register-error' : undefined}
            type="email"
            required
            maxLength={AUTH_LIMITS.maxEmail}
            autoComplete="email"
            name="email"
          />

          <AuthField
            id="register-password"
            label={t('common.auth.password')}
            errorId={error ? 'register-error' : undefined}
            type="password"
            required
            minLength={AUTH_LIMITS.minPassword}
            maxLength={AUTH_LIMITS.maxPassword}
            autoComplete="new-password"
            name="password"
          />

          <AuthAlert id="register-error" message={error} />

          <Button id="register-submit" type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('web.auth.creatingAccount') : t('web.auth.createAccount')}
          </Button>
        </form>
      )}
    </>
  );
}
