'use client';

import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@chatofy/ui/react';

/**
 * Google sign-in.
 *
 * Redirects rather than posting anything itself: the id_token is handed to the
 * server-side callback in `auth.ts`, which forwards it to POST /auth/google.
 * The browser never carries that token to the API, and never sees a decision
 * made from a payload it could have written.
 *
 * Whether this renders at all is decided by Auth.js's own
 * `GET /api/auth/providers`, not by the API — the button works only if THIS app
 * has a Google client id and secret, which the API cannot see. Asking the API
 * would produce a button that errors, or a hidden one that would have worked.
 */
export function GoogleButton() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/translate';

  return (
    <Button
      id="login-google"
      type="button"
      variant="outline"
      onClick={() => void signIn('google', { redirectTo: next })}
    >
      Continue with Google
    </Button>
  );
}
