import type { Metadata } from 'next';
import { getT } from '@/i18n/server';

/**
 * Tab title for every `/conference` route. The pages are client components, which
 * is why the metadata lives here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.conference') };
}

export default function ConferenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
