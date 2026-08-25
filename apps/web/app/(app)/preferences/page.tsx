import type { Metadata } from 'next';
import { ConversationPreferencesCard } from '@/components/preferences/conversation-preferences-card';
import { InterfacePreferencesCard } from '@/components/preferences/interface-preferences-card';

export const metadata: Metadata = { title: 'Preferences · Chatofy' };

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
