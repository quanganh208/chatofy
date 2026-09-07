'use client';

import { useEffect, useRef, useState } from 'react';
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

  // The form goes when the confirmation arrives, and the submit button that was
  // pressed goes with it — so focus fell to `<body>`, at the top of the page,
  // away from the one sentence that says what happened. It moves to that
  // sentence instead.
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (submitted) notice.current?.focus();
  }, [submitted]);

  return (
    <>
      {/* Mounted from the start and never unmounted, for the reason
          `auth-alert.tsx` sets out for the failure path: a live region has to
          exist BEFORE its content changes for assistive technology to report the
          change, and one created in the same commit as its text is a coin flip
          across implementations. This branch used to do exactly that.

          `sr-only` rather than absent while empty, so the region is in the
          accessibility tree the whole time without spending a row of the card's
          column above the form. `hidden` would collapse it and undo the point. */}
      <p
        id="register-success"
        role="status"
        ref={notice}
        // Focusable only as a destination — never in the tab order, where an
        // empty paragraph would be a stop that says nothing.
        tabIndex={-1}
        className={submitted ? 'text-prose' : 'sr-only'}
      >
        {submitted ? t('web.auth.checkYourEmail') : null}
      </p>

      {submitted ? null : (
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
      )}
    </>
  );
}
