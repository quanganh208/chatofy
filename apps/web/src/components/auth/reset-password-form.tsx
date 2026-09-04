'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authErrorMessage } from './auth-error-message';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { resetPassword } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';

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
  const t = useTranslate();
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
        {t('web.auth.resetLinkMissingCode')}
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
            setError(authErrorMessage(err, t, 'web.auth.resetFailed'));
          });
      }}
    >
      {/* Every input carries the flag, not just the rejected one. The API does say
          which field it refused — `apiErrorSchema` has `details[].path`, filled in
          by the exceptions filter — but `authErrorMessage` reduces the whole error
          to one string, so nothing here knows. Flagging all of them is the honest
          reading of "something in this form was rejected"; attributing the right
          field means changing what `authErrorMessage` returns, which is a larger
          change than this one and was deliberately not taken. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">{t('web.auth.newPassword')}</Label>
        <Input
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'reset-error' : undefined}
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
        {submitting ? t('web.auth.resetting') : t('web.auth.resetPasswordSubmit')}
      </Button>
    </form>
  );
}
