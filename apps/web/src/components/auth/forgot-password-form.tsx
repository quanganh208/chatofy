'use client';

import { useEffect, useRef, useState } from 'react';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { AuthAlert } from '@/components/auth/auth-alert';
import { AuthField } from '@/components/auth/auth-field';
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
        id="forgot-success"
        role="status"
        ref={notice}
        // Focusable only as a destination — never in the tab order, where an
        // empty paragraph would be a stop that says nothing.
        tabIndex={-1}
        className={submitted ? 'text-prose' : 'sr-only'}
      >
        {submitted ? t('web.auth.resetLinkSent') : null}
      </p>

      {submitted ? null : (
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
          {/* Every input carries the flag, not just the rejected one. The API does say
              which field it refused — `apiErrorSchema` has `details[].path`, filled in
              by the exceptions filter — but `authErrorMessage` reduces the whole error
              to one string, so nothing here knows. Flagging all of them is the honest
              reading of "something in this form was rejected"; attributing the right
              field means changing what `authErrorMessage` returns, which is a larger
              change than this one and was deliberately not taken. */}
          <AuthField
            id="forgot-email"
            label={t('web.auth.email')}
            errorId={error ? 'forgot-error' : undefined}
            type="email"
            required
            maxLength={AUTH_LIMITS.maxEmail}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <AuthAlert id="forgot-error" message={error} />

          <Button id="forgot-submit" type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('web.auth.sending') : t('web.auth.sendResetLink')}
          </Button>
        </form>
      )}
    </>
  );
}
