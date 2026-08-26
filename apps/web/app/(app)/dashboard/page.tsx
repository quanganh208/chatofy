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
 * The schema has one model, `User` — no conversation history, no usage metering, no
 * session records. A tile reading "0 conversations" would be inventing a metric the
 * product does not collect, and it would contradict the claim the landing makes about
 * keeping nothing. What is left is the three things that are true: the direction you
 * are about to translate in, whether the microphone and the service will cooperate,
 * and where else this runs.
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
