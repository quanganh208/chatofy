'use client';

import * as React from 'react';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { SidebarInset, SidebarProvider } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { MEASURE } from './measures';

/**
 * The signed-in product frame: sidebar, topbar, and the measured content column.
 *
 * ## The collapse mechanism, decided here and only here
 *
 * **The route wins.** Which routes open collapsed is a property of the surface, not a
 * preference: `/translate` puts the transcript first, so it opens as a rail. A manual
 * toggle applies until the next navigation, and then the route's answer takes over
 * again.
 *
 * The alternative was the stock behaviour — a `sidebar_state` cookie read into
 * `defaultOpen`, with the route only choosing the very first visit. It was rejected
 * because the two rules cannot both be authoritative and the disagreement is silent:
 * expand the rail on `/translate`, navigate away and back, and either the sidebar
 * reopens against the route or stays collapsed against the cookie. Whichever way it
 * lands, nothing in the code says which was intended.
 *
 * So `open` is held here and `SidebarProvider` is controlled. The primitive still
 * writes that cookie on every toggle — it is upstream code and editing it would fork
 * this component from the CLI that generates it — and **nothing reads it**. That is
 * the point worth carrying forward: the cookie is inert, not a second mechanism, and
 * the day someone wires it into `defaultOpen` they are re-opening this decision.
 *
 * ## Why the measure is here and not in the page
 *
 * Same reason it was in the old shell: a route asks for a name, never a width. `wide` is
 * the app default; `/translate` asks for `workspace`, because two columns of transcript
 * need twice the room one column does. See `measures.ts`.
 */

/**
 * Routes that open as a rail (exact match).
 *
 * One entry, and it is exact rather than a prefix — a prefix match would quietly start
 * claiming `/translate/history` the day it exists.
 */
const RAIL_ROUTES: readonly Route[] = ['/translate'];

/**
 * Route prefixes that also open as a rail.
 *
 * Used for dynamic routes like `/conference/[roomId]` where the path can't be
 * expressed as a static `Route`. Prefix is intentionally specific — `/conference/`
 * (with trailing slash) so the lobby at `/conference` stays expanded.
 */
const RAIL_PREFIXES: readonly string[] = ['/conference/'];

const opensExpanded = (pathname: string) =>
  !RAIL_ROUTES.some((route) => route === pathname) &&
  !RAIL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Routes laid out as two columns rather than one, and measured for it.
 *
 * Same shape as `RAIL_ROUTES` and for the same reason: the route asks for a
 * NAME, the width lives in `measures.ts`, and the match is exact so the day
 * `/translate/history` exists it does not silently inherit a measure nobody
 * chose for it.
 */
const WORKSPACE_ROUTES: readonly Route[] = ['/translate'];

const measureFor = (pathname: string) =>
  WORKSPACE_ROUTES.some((route) => route === pathname) ? MEASURE.workspace : MEASURE.wide;

/**
 * Routes that render edge-to-edge with no padding or max-width constraint.
 *
 * These are full-screen app surfaces (video conference room) that own their
 * own internal layout and should not be framed by the standard content column.
 */
const FLUSH_PREFIXES: readonly string[] = ['/conference/'];

const isFlush = (pathname: string) => FLUSH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  /*
    A toggle belongs to the route it was made on, which is the rule stated as data
    rather than enforced by an effect. `open` is then derived, so navigating cannot
    leave a stale value behind and there is no render where the sidebar is briefly
    the previous route's shape. Resetting it in a `useEffect` instead would work and
    would also mean a second render on every navigation, plus a lint rule to argue
    with — for a value that was never state in the first place.
  */
  const [override, setOverride] = React.useState<{ pathname: string; open: boolean }>();
  const open = override?.pathname === pathname ? override.open : opensExpanded(pathname);
  const setOpen = React.useCallback(
    (next: boolean) => setOverride({ pathname, open: next }),
    [pathname],
  );

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <AppSidebar />
      {/*
        `SidebarInset` renders the `<main>`, so this is the skip link's target.
        `tabIndex={-1}` is what lets focus actually land here — without it the fragment
        changes, focus stays in the nav, and the skip link looks implemented while doing
        nothing.
      */}
      {/*
        Flush routes (conference room) cap SidebarInset at exactly h-svh so the
        chain of flex-1/h-full inside resolves against a fixed height instead of
        the SidebarProvider's min-h-svh which can grow with content.
        overflow-hidden on SidebarInset prevents the body from ever scrolling.
      */}
      <SidebarInset
        id="main"
        tabIndex={-1}
        className={isFlush(pathname) ? 'h-svh overflow-hidden' : undefined}
      >
        <AppTopbar />
        {/* `min-h-0` so a screen that wants to fill the viewport can: without it
            a flex child's implicit min-height is its content, and a transcript
            asking for the leftover space gets its own height back instead. */}
        {isFlush(pathname) ? (
          <div className="flex w-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        ) : (
          <div
            className={cn(
              'mx-auto flex w-full min-h-0 flex-1 flex-col gap-8 px-6 py-8',
              measureFor(pathname),
            )}
          >
            {children}
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
