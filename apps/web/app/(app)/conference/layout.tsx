import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isConferenceEnabled } from '@/config/feature-flags';
import { getT } from '@/i18n/server';

/**
 * The gate for every `/conference` route, and its tab title.
 *
 * Video conferencing ships behind `NEXT_PUBLIC_CONFERENCE_ENABLED`: a build
 * without it answers 404 for the lobby and every room, and the nav entry is
 * dropped in `nav-items.ts`. One layout rather than a check in each page, so a
 * route added under this folder later cannot forget it. The pages below are
 * `'use client'`, which is also why the metadata lives here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.conference') };
}

export default function ConferenceLayout({ children }: { children: React.ReactNode }) {
  if (!isConferenceEnabled()) notFound();
  return children;
}
