import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/../auth';
import { AppChrome } from '@/components/layout/app-chrome';
import { AppToaster } from '@/components/layout/app-toaster';
import { SkipLink } from '@/components/layout/skip-link';
import { SessionGuard } from '@/components/session-guard';
import { isLiveSession } from '@/lib/session-guard';

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
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The same predicate the route guard reads, for the same reason: a cookie
  // that is present but no longer renewable must not open this surface.
  if (!isLiveSession(await auth())) redirect('/login');

  // The sidebar's open or rail state is the reader's choice, written by the sidebar
  // primitive on every toggle. Read here so the first paint is already that shape;
  // unset means open. See `app-chrome.tsx`.
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <>
      <SkipLink />
      {/* Mounted HERE and never beside the provider in the root layout. A guard
          on every route would also cover the five the matcher deliberately
          exempts — so someone whose refresh has terminally failed, clicking the
          `/reset-password?token=…` link in their mail, would be signed out to
          /login WITH THE RESET TOKEN GONE FROM THE URL. That is the one flow in
          this system that revokes anything, broken for exactly the people most
          likely to need it. Inside this group it covers precisely the routes the
          matcher gates. */}
      <SessionGuard />
      <AppChrome defaultOpen={sidebarOpen}>{children}</AppChrome>
      {/* The page's toast host, after the chrome so it stacks above it. The only other
          host is Settings' own, mounted inside its dialog while it is open (see
          `layout/app-toaster.tsx`). Screens speak through `lib/notify.ts`, never by
          mounting a host of their own. */}
      <AppToaster />
    </>
  );
}
