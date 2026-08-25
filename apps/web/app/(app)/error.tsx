'use client';

import { Button } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';

/**
 * A failure inside the product surface.
 *
 * Scoped to the group so the chrome around it survives — once this group has a
 * sidebar, a thrown route must not take the navigation down with it and leave the
 * reader on a blank page with no way out.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <AppShell>
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-heading font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-prose text-body max-w-prose">
          That did not load. Try again, and if it keeps happening the translation service may be
          unreachable.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </AppShell>
  );
}
