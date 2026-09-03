import type { Metadata } from 'next';
import { ReadinessCard } from '@/components/dashboard/readiness-card';
import { StartConversationCard } from '@/components/dashboard/start-conversation-card';
import { SurfacesCard } from '@/components/dashboard/surfaces-card';
import { getT } from '@/i18n/server';

/**
 * A tab title is a string a person reads, so it comes from the dictionary like every
 * other one. `generateMetadata` rather than a static object because resolving the
 * locale awaits a cookie — see `i18n/server.ts`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.dashboard') };
}

/**
 * The post-login home. Everything on it is real.
 *
 * **There are no numbers here, and that is the design rather than a gap to fill.**
 * The REASON changed when conversation history shipped; the design did not.
 * Conversations are stored now, so a count would no longer be an invented metric —
 * it would simply not be this page's job. Counting belongs where the things
 * counted are, which is `/history`, and `page.spec.tsx` asserts no digit appears
 * here. What is left is the three things that are true at a glance: the direction
 * you are about to translate in, whether the microphone and the service will
 * cooperate, and where else this runs.
 *
 * A server component so it can export `metadata`; the three cards are clients because
 * each reads something only a browser knows — stored settings, a permission, a live
 * probe. The session gate is `proxy.ts`, which allows only an explicit list of public
 * paths, so this route needs no check of its own.
 *
 * No heading. The topbar already says "Dashboard", and the largest text on the page is
 * the one card title that names an action.
 */
export default function DashboardPage() {
  return (
    <>
      <StartConversationCard />
      <div className="grid gap-6 md:grid-cols-2">
        <ReadinessCard />
        <SurfacesCard />
      </div>
    </>
  );
}
