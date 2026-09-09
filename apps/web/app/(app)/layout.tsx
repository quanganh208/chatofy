import { AppChrome } from '@/components/layout/app-chrome';
import { SkipLink } from '@/components/layout/skip-link';

/**
 * The signed-in product surface, and from here on it looks like one.
 *
 * The skip link is rendered before the chrome, deliberately and structurally: it has to
 * be the first thing a keyboard reaches, and the only way to guarantee that is to put it
 * above everything that can hold focus. This group is where it earns its place — the
 * sidebar puts the whole navigation in front of the content on every route.
 *
 * Every route under `/translate` is in this group now. The two lab routes that sat
 * outside it — the continuous-mode experiment and the single-shot REST page, reachable
 * by URL and linked from nothing — are deleted, along with the plain frame that existed
 * only to give them a way back.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <AppChrome>{children}</AppChrome>
    </>
  );
}
