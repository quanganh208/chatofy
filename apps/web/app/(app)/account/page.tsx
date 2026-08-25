import type { Metadata } from 'next';
import { AccountCard } from '@/components/account/account-card';

export const metadata: Metadata = { title: 'Account · Chatofy' };

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
