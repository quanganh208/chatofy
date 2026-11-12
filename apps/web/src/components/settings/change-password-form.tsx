'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import type { MessageKey } from '@chatofy/i18n';
import { AUTH_LIMITS } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { AuthAlert } from '@/components/auth/auth-alert';
import { AuthField } from '@/components/auth/auth-field';
import { useAccessToken } from '@/hooks/use-access-token';
import { useTranslate } from '@/i18n/provider';
import type { ChangePasswordFailure } from '@/lib/change-password-handoff';
import { formText } from '@/lib/form-text';

/**
 * What each refusal tells the reader to do. A code this table does not know —
 * including a fault, which Auth.js reports as `CallbackRouteError` with no code —
 * falls to the generic "nothing was changed, try again".
 */
const FAILURE_COPY: Record<Exclude<ChangePasswordFailure, 'server'>, MessageKey> = {
  'wrong-current': 'web.account.currentPasswordWrong',
  'no-password': 'web.account.noPasswordYet',
  invalid: 'web.account.changePasswordInvalid',
  'rate-limited': 'web.account.changePasswordThrottled',
  'session-expired': 'web.account.changePasswordSessionExpired',
};

function failureCopy(code: string | undefined): MessageKey {
  return code !== undefined && Object.hasOwn(FAILURE_COPY, code)
    ? FAILURE_COPY[code as keyof typeof FAILURE_COPY]
    : 'web.account.changePasswordFailed';
}

/**
 * Current password, new password, and the new one again.
 *
 * Submitted through `signIn('password-change')`, not through `authedFetch`. The
 * change revokes every token issued before it — the one this browser holds
 * included — so the API answers with a replacement pair, and only a sign-in pass
 * on the Next server can put that pair in the httpOnly cookie without the refresh
 * token touching client JS. `signIn` with `redirect: false` also refetches the
 * client session when it succeeds, so `useSession()` sees the new access token.
 *
 * The confirmation is checked HERE and never sent: it protects the reader from a
 * typo they could not see, and the API has no use for a second copy.
 */
export function ChangePasswordForm({
  onDone,
  onCancel,
  onBusyChange,
}: {
  /** The change committed. The parent collapses the form and says so. */
  onDone: () => void;
  onCancel: () => void;
  /**
   * The request started or settled. A parent dialog holds itself open while it is in
   * flight, so a refusal is never lost to an Esc that unmounted the form.
   */
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslate();
  const accessToken = useAccessToken();
  const [error, setError] = useState<string>();
  const [submitting, setSubmittingState] = useState(false);
  const setSubmitting = (busy: boolean) => {
    setSubmittingState(busy);
    onBusyChange?.(busy);
  };

  return (
    // `method="post"` for the reason `login-form.tsx` gives: a submit that lands
    // before hydration must not become a GET with passwords in the query string.
    <form
      method="post"
      className="flex flex-col gap-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        // Read from the form, not React state — see `login-form.tsx`.
        const form = new FormData(event.currentTarget);
        const currentPassword = formText(form, 'currentPassword');
        const newPassword = formText(form, 'newPassword');
        if (newPassword !== formText(form, 'confirmPassword')) {
          setError(t('web.account.passwordsDoNotMatch'));
          return;
        }

        setSubmitting(true);
        setError(undefined);
        void signIn('password-change', {
          accessToken: accessToken.current(),
          currentPassword,
          newPassword,
          redirect: false,
        }).then(
          (result) => {
            setSubmitting(false);
            if (result?.error) {
              setError(t(failureCopy(result.code)));
              return;
            }
            onDone();
          },
          () => {
            setSubmitting(false);
            setError(t('web.account.changePasswordFailed'));
          },
        );
      }}
    >
      {/* Every field carries the flag, for the reason `reset-password-form.tsx`
          gives: the message is form-level, and this form does not know which field
          the API refused. */}
      <AuthField
        id="current-password"
        label={t('web.account.currentPassword')}
        errorId={error ? 'change-password-error' : undefined}
        type="password"
        required
        maxLength={AUTH_LIMITS.maxPassword}
        autoComplete="current-password"
        name="currentPassword"
      />
      <AuthField
        id="new-password"
        label={t('web.auth.newPassword')}
        errorId={error ? 'change-password-error' : undefined}
        type="password"
        required
        minLength={AUTH_LIMITS.minPassword}
        maxLength={AUTH_LIMITS.maxPassword}
        autoComplete="new-password"
        name="newPassword"
      />
      <AuthField
        id="confirm-password"
        label={t('web.account.confirmNewPassword')}
        errorId={error ? 'change-password-error' : undefined}
        type="password"
        required
        minLength={AUTH_LIMITS.minPassword}
        maxLength={AUTH_LIMITS.maxPassword}
        autoComplete="new-password"
        name="confirmPassword"
      />

      <AuthAlert id="change-password-error" message={error} />

      <div className="flex flex-wrap items-center gap-2.5">
        <Button id="change-password-submit" type="submit" disabled={submitting}>
          {submitting ? t('web.account.changingPassword') : t('web.account.changePasswordSubmit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          {t('web.account.changePasswordCancel')}
        </Button>
        <Link
          href="/forgot-password"
          className="text-hint text-muted-foreground hover:text-foreground ml-auto underline-offset-4 hover:underline"
        >
          {t('web.auth.forgotPasswordLink')}
        </Link>
      </div>
    </form>
  );
}
