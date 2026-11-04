import type { Metadata } from 'next';
import { getT } from '@/i18n/server';

/** Two-way's own tab title, over the one `translate/layout.tsx` gives one-way. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.translateTwoWay') };
}

export default function TwoWayTranslateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
