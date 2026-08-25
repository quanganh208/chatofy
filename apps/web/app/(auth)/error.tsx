'use client';

import { Button } from '@chatofy/ui/react';

/**
 * A failure on one of the token-carrying routes.
 *
 * **Nothing from the URL is rendered here, and that is the point.** These are the
 * routes reached from a mailed link: `/verify-email?token=…` and
 * `/reset-password?token=…`. `error.message` can carry whatever threw, a `?next=`
 * value can carry a path, and echoing either into the page puts a live credential in
 * front of whoever is looking at the screen — and into a screenshot, a support
 * ticket, or a bug report.
 *
 * So the copy is fixed. The only thing offered is a way to try again, which does not
 * need to know what went wrong.
 */
export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-heading font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-prose text-body max-w-prose">
        That step could not be completed. The link may have expired — request a new one and try
        again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
