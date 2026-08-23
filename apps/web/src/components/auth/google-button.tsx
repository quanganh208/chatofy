'use client';

import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@chatofy/ui/react';
import { sameOriginPath } from '@/lib/same-origin-path';

/**
 * Google's mark, at the size their brand terms specify for a sign-in button.
 *
 * Four colours, and it stays four colours: recolouring it — including forcing it
 * to `currentColor` so it followed the theme, which is what a shared icon would
 * do here — is not permitted by Google's terms. So it is written out rather than
 * pulled from the icon set, and it carries no `size-*` class of its own beyond
 * the explicit 18px, which is why `Button`'s `[&_svg:not([class*='size-'])]`
 * rule leaves it alone.
 */
function GoogleMark() {
  return (
    <svg className="size-[18px]" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

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
  // Auth.js applies its own same-origin clamp to `redirectTo`, so this path was
  // never the open one. Clamped here anyway, so both sign-in routes answer the
  // same query string the same way rather than one of them relying on a
  // guarantee that lives in a dependency.
  const next = sameOriginPath(params.get('next'));

  return (
    <Button
      id="login-google"
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void signIn('google', { redirectTo: next })}
    >
      <GoogleMark />
      Continue with Google
    </Button>
  );
}
