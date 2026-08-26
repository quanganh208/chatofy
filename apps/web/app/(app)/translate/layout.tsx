import type { Metadata } from 'next';
import { getT } from '@/i18n/server';

/**
 * A title for the product's main surface, which had none.
 *
 * It lives in a layout rather than beside the page because `page.tsx` is
 * `'use client'` — it owns the settings state — and a client module cannot export
 * `metadata`. Next evaluates this on the server, which is also where the locale will
 * be resolved when these become `generateMetadata`.
 *
 * The root layout's title answered for every route, so a reader with the translator
 * and the landing page open saw two tabs both reading "Chatofy".
 */
/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.translate') };
}

export default function TranslateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
