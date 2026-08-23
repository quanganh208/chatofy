'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authErrorMessage } from './auth-error-message';
import { VERIFY_EMAIL_MESSAGES } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { verifyEmail } from '@/clients/api-client';

/**
 * Redeems a mailed verification link — on an explicit click, never on mount.
 *
 * Mail scanners GET this page unprompted, so the GET that renders it must
 * consume nothing: the token is spent only by the POST this button issues, and
 * nothing here calls `verifyEmail` outside that click handler.
 *
 * A re-followed link is not an error. The API answers a second redemption with
 * the same 200 as the first, distinguished only by its message — so the two are
 * compared against the SHARED constants in `@chatofy/types` rather than a
 * substring of copy that lives only in the API, which would break on a reword
 * with green tests on both sides. Double-clicking a mailed link, or a scanner
 * that followed it first, is ordinary, and the account is already exactly what
 * the visitor wanted.
 */
export function VerifyEmailClient() {
  const router = useRouter();
  const params = useSearchParams();

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
        That link is missing its verification code.
      </p>
    );
  }

  if (alreadyExists) {
    return (
      <p id="verify-already-exists" role="status" className="text-prose">
        That account already exists.{' '}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-prose">Confirm below to finish creating your account.</p>

      {error ? (
        <p id="verify-error" role="alert" className="text-destructive text-prose">
          {error}
        </p>
      ) : null}

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
              if (result.message === VERIFY_EMAIL_MESSAGES.alreadyExists) {
                setAlreadyExists(true);
                setSubmitting(false);
                return;
              }
              router.push('/login?verified=1');
            })
            .catch((err: unknown) => {
              setSubmitting(false);
              setError(authErrorMessage(err, 'Could not verify this link. Try again.'));
            });
        }}
      >
        {submitting ? 'Verifying…' : 'Verify email'}
      </Button>
    </div>
  );
}
