import type { Metadata } from 'next';
import { ConversationPreferencesCard } from '@/components/preferences/conversation-preferences-card';
import { InterfacePreferencesCard } from '@/components/preferences/interface-preferences-card';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.preferences') };
}

/**
 * Everything that is a choice rather than an action.
 *
 * Two cards. The first is the translate settings panel — the same component the topbar
 * gear opens on `/translate`, mounted where nothing is running so direction and voice
 * are editable. The second is the interface itself.
 *
 * Session-gated by `proxy.ts`, which allows only an explicit list of public paths, so
 * this route needs no check of its own.
 */
export default function PreferencesPage() {
  return (
    <>
      <ConversationPreferencesCard />
      <InterfacePreferencesCard />
    </>
  );
}
