import type { Metadata } from 'next';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.history') };
}

/**
 * One stored conversation, by URL.
 *
 * Renders nothing: the History layout reads the id (`useParams`) and draws the
 * conversation in its reading pane, keyed by that id — so arriving here from the
 * newest conversation already open at `/history` keeps the same element, its tab
 * and its audio. The fetch is the client's because it needs the caller's bearer
 * token; the ownership check is the API's. This page exists for its URL, its
 * metadata and the dynamic segment the layout reads.
 */
export default function ConversationPage() {
  return null;
}
