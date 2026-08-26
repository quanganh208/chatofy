import type { Metadata } from 'next';
import { AccountCard } from '@/components/account/account-card';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.account') };
}

/**
 * The account itself: who it is, how to change its password, and how to leave.
 *
 * Sign out lives here as well as behind the sidebar avatar. That is one action reached
 * two ways — both call `signOutOfChatofy` — rather than two implementations, and the
 * page is where the sentence explaining what signing out actually does has room to be
 * accurate.
 *
 * Session-gated by `proxy.ts`, which allows only an explicit list of public paths.
 */
export default function AccountPage() {
  return <AccountCard />;
}
