import type { Metadata } from 'next';
import { AiContextSection } from '@/components/preferences/ai-context-section';
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
 * Three sections, and two of them are surfaces. The interface rows sit on the page
 * ground; the AI Context library and the defaults a new conversation starts from are
 * the screen's two elevated panels, because each is a thing you actually sit down and
 * work on — a library of named authored objects, and the settings a conversation
 * begins from. Two is the ceiling on this screen, which is why the context editor
 * expands INLINE rather than into a dialog: a portalled surface would be a third.
 *
 * Interface comes first: it is what a reader is most likely to have come here to
 * change, and it is the shortest of the three. The context library sits between the
 * two, because it is authored once and then only picked, whereas the defaults below
 * it are read every time a conversation starts.
 *
 * Session-gated by `proxy.ts`, which allows only an explicit list of public paths, so
 * this route needs no check of its own.
 */
export default function PreferencesPage() {
  return (
    <>
      <InterfacePreferencesSection />
      <AiContextSection />
      <ConversationDefaultsSection />
    </>
  );
}
