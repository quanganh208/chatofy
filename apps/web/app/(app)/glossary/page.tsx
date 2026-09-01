import type { Metadata } from 'next';
import { GlossaryCard } from '@/components/glossary/glossary-card';
import { getT } from '@/i18n/server';

/**
 * The tab title is a string a person reads, so it comes from the dictionary.
 * `generateMetadata` rather than a static object because resolving the locale
 * awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.glossary') };
}

/**
 * Manage the domain-terminology glossary applied to every translation on this
 * account. Session-gated by `proxy.ts`, which allows only an explicit list of
 * public paths, so this route needs no check of its own.
 */
export default function GlossaryPage() {
  return <GlossaryCard />;
}
