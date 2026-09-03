import type { Metadata } from 'next';
import { HistoryScreen } from '@/components/history/history-screen';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.history') };
}

/**
 * Conversations this account has finished and kept.
 *
 * A server component so it can export metadata; the screen below is a client
 * because the list is fetched with the caller's bearer token. Session-gated by
 * `proxy.ts`, which allows only an explicit list of public paths, so this route
 * needs no check of its own.
 *
 * No heading — the topbar already says "History", the same reason the dashboard
 * has none.
 */
export default function HistoryPage() {
  return <HistoryScreen />;
}
