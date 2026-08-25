'use client';

import { Button } from '@chatofy/ui/react';

/** A failure on the public surface. Public, so it says as little as the others. */
export default function MarketingError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-heading font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-prose text-body max-w-prose">This page did not load. Try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
