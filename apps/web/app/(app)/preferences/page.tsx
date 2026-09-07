import type { Metadata } from 'next';
import { ConversationDefaultsSection } from '@/components/preferences/conversation-defaults-section';
import { InterfacePreferencesSection } from '@/components/preferences/interface-preferences-section';
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
 * Two sections, and only one of them is a surface. The interface rows sit on the page
 * ground; the defaults a new conversation starts from are the screen's one elevated
 * panel, because they are the thing you actually sit down and set.
 *
 * Interface comes first: it is what a reader is most likely to have come here to
 * change, and it is the shorter of the two.
 *
 * Session-gated by `proxy.ts`, which allows only an explicit list of public paths, so
 * this route needs no check of its own.
 */
export default function PreferencesPage() {
  return (
    <>
      <InterfacePreferencesSection />
      <ConversationDefaultsSection />
    </>
  );
}
