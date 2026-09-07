'use client';

import { useEffect, useState } from 'react';
import { AuthAlert } from '@/components/auth/auth-alert';
import { AuthLink } from '@/components/auth/auth-link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authErrorMessage } from './auth-error-message';
import { Button } from '@chatofy/ui/react';
import { verifyEmail } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';

/**
 * Redeems a mailed verification link — on an explicit click, never on mount.
 *
 * Mail scanners GET this page unprompted, so the GET that renders it must
 * consume nothing: the token is spent only by the POST this button issues, and
 * nothing here calls `verifyEmail` outside that click handler.
 *
 * A re-followed link is not an error. The API answers a second redemption with the
 * same 200 as the first, distinguished by its `code` — which is what this comment
 * used to ask for and now has: the two cases were compared by matching the api's
 * English copy, so a reword broke the branch silently, with green tests on both sides
 * because each mocks the other. Double-clicking a mailed link, or a scanner that
 * followed it first, is ordinary, and the account is already exactly what the visitor
 * wanted.
 */
export function VerifyEmailClient() {
  const router = useRouter();
  const params = useSearchParams();

  const t = useTranslate();

  // Read once, into state, before the effect below strips the query string —
  // the token is a mailed, single-use credential, and it should sit in
  // `location.search` for no longer than it takes this line to read it.
  const [token] = useState(() => params.get('token'));
  const [error, setError] = useState<string>();
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (!token) {
    return (
      <p role="alert" className="text-destructive text-prose">
        {t('web.auth.verifyLinkMissingCode')}
      </p>
    );
  }

  if (alreadyExists) {
    return (
      <p id="verify-already-exists" role="status" className="text-prose">
        {t('web.auth.accountExists')} <AuthLink href="/login">{t('web.auth.signIn')}</AuthLink>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-prose">{t('web.auth.verifyEmailBody')}</p>

      <AuthAlert id="verify-error" message={error} />

      <Button
        id="verify-submit"
        type="button"
        className="w-full"
        disabled={submitting}
        onClick={() => {
          setSubmitting(true);
          setError(undefined);
          verifyEmail({ token })
            .then((result) => {
              if (result.code === 'ACCOUNT_ALREADY_EXISTS') {
                setAlreadyExists(true);
                setSubmitting(false);
                return;
              }
              router.push('/login?verified=1');
            })
            .catch((err: unknown) => {
              setSubmitting(false);
              setError(authErrorMessage(err, t, 'web.auth.verifyFailed'));
            });
        }}
      >
        {submitting ? t('web.auth.verifying') : t('web.auth.verifyEmailSubmit')}
      </Button>
    </div>
  );
}
