import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InviteAcceptClient } from '@/components/team/invite-accept-client';
import { getT } from '@/i18n/server';

/**
 * Kept out of search results, and out of the proxy: the invite mail's link carries a
 * live token, so a signed-out visitor must reach this page itself, never a login
 * redirect that would copy the token into `?next=`. The client moves the token out
 * of the URL on first render.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.invite'), robots: { index: false, follow: false } };
}

/**
 * No card: the page answers one question, whether to join, and its only filled
 * control is Join. `InviteAcceptClient` reads `useSearchParams`, so it sits in the
 * same `Suspense` boundary `/verify-email` uses.
 */
export default async function InvitePage() {
  const t = await getT();

  return (
    <>
      <h1 className="text-title font-display font-light tracking-tight">
        {t('web.invite.heading')}
      </h1>
      <Suspense fallback={null}>
        <InviteAcceptClient />
      </Suspense>
    </>
  );
}
