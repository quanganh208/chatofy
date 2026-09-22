import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { PlainFrame } from '@/components/layout/plain-frame';
import { getT } from '@/i18n/server';

/**
 * An address this app does not have.
 *
 * Root-level, so it answers for every group. Before this the product showed Next's
 * default 404 — correct, and belonging to no product in particular.
 *
 * Strings come from `getT()`, not the hook: this is a server component, and the
 * `useTranslate` context is client-only — calling it here threw on every 404.
 *
 * The way out points at `/` rather than at the translator: a 404 is reachable
 * signed out, and sending a signed-out visitor to a gated route would bounce them
 * to a login form they never asked for.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <PlainFrame>
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-heading font-display font-normal tracking-tight">
          {t('web.error.notFound')}
        </h1>
        <p className="text-prose text-body max-w-prose">{t('web.error.notFoundBody')}</p>
        <Button asChild>
          <Link href="/">{t('web.error.goToStart')}</Link>
        </Button>
      </div>
    </PlainFrame>
  );
}
