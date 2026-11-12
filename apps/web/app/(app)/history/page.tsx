import type { Metadata } from 'next';
import { HistoryNewestDetail } from '@/components/history/history-newest-detail';
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
 * The list itself is the History layout's (`layout.tsx`), so it survives moving
 * between conversations. This page is only what fills the reading pane at
 * `/history`: the newest conversation on a wide screen, nothing on a narrow one.
 *
 * A server component so it can export metadata. Session-gated by `proxy.ts`, which
 * allows only an explicit list of public paths, so this route needs no check of
 * its own.
 */
export default function HistoryPage() {
  return <HistoryNewestDetail />;
}
