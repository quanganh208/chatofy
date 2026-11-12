import type { Metadata } from 'next';
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
 * Renders nothing: the list AND the open conversation are the History layout's
 * (`layout.tsx`), so the newest conversation opened here and the same conversation
 * opened from its row are one mounted element. This page exists for its URL and
 * its metadata. Session-gated by `proxy.ts`, which allows only an explicit list of
 * public paths, so this route needs no check of its own.
 */
export default function HistoryPage() {
  return null;
}
