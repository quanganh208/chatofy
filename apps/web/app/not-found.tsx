import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';

/**
 * An address this app does not have.
 *
 * Root-level, so it answers for every group. Before this the product showed Next's
 * default 404 — correct, and belonging to no product in particular.
 *
 * The way out points at `/` rather than at the translator: a 404 is reachable
 * signed out, and sending a signed-out visitor to a gated route would bounce them
 * to a login form they never asked for.
 */
export default function NotFound() {
  return (
    <AppShell measure="reading">
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-heading font-semibold tracking-tight">This page does not exist</h1>
        <p className="text-prose text-body max-w-prose">
          The address may have changed, or the link that brought you here may be out of date.
        </p>
        <Button asChild>
          <Link href="/">Go to the start</Link>
        </Button>
      </div>
    </AppShell>
  );
}
