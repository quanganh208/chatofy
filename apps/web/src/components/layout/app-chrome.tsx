'use client';

import * as React from 'react';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { SidebarInset, SidebarProvider } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import { useStoredWidth } from '@/hooks/use-stored-width';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { ChromeSlotsProvider, useChromeSlots } from './chrome-slots';
import { MobileTabBar } from './mobile-tab-bar';
import { MEASURE } from './measures';

/**
 * The signed-in product frame: sidebar, topbar, and the measured content column.
 *
 * ## The collapse mechanism, decided here and only here
 *
 * **The reader wins.** Open or a rail is the reader's choice, kept in the
 * `sidebar_state` cookie the primitive writes on every toggle and read on the server
 * (`app/(app)/layout.tsx`) so the first paint is already the remembered shape. The
 * translator used to open as a rail by route; that took the choice away on the one
 * screen people sit on longest, and was dropped for it.
 *
 * One surface still asks for a rail: the conference room, which owns the whole
 * screen. It opens as a rail whatever the reader chose, without changing that
 * choice; a toggle made inside it is a choice like any other, and the room opens
 * as a rail again next time.
 *
 * ## Why the measure is here and not in the page
 *
 * Same reason it was in the old shell: a route asks for a name, never a width. `wide` is
 * the app default; the two translator pages ask for `workspace`, because two columns of transcript
 * need twice the room one column does. See `measures.ts`.
 */

/**
 * Route prefixes that open as a rail whatever the reader chose.
 *
 * Used for dynamic routes like `/conference/[roomId]` where the path can't be
 * expressed as a static `Route`. Prefix is intentionally specific — `/conference/`
 * (with trailing slash) so the lobby at `/conference` follows the reader's choice.
 */
const RAIL_PREFIXES: readonly string[] = ['/conference/'];

const asksForRail = (pathname: string) =>
  RAIL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Routes laid out as two columns rather than one, and measured for it.
 *
 * The route asks for a NAME, the width lives in `measures.ts`, and the match is
 * exact so the day
 * `/translate/history` exists it does not silently inherit a measure nobody
 * chose for it.
 */
const WORKSPACE_ROUTES: readonly Route[] = ['/translate/one-way', '/translate/two-way'];

/**
 * Routes laid out for the full page measure: the conference landing is a two-column
 * hero, and the content pages lay their sections out in columns from `lg` — a 672px
 * column would squeeze either back to a form.
 */
const FULL_PAGE_ROUTES: readonly Route[] = ['/conference', '/glossary', '/preferences', '/account'];

const measureFor = (pathname: string) =>
  WORKSPACE_ROUTES.some((route) => route === pathname)
    ? MEASURE.workspace
    : FULL_PAGE_ROUTES.some((route) => route === pathname)
      ? MEASURE.page
      : MEASURE.wide;

/**
 * Routes that render edge-to-edge with no padding or max-width constraint.
 *
 * These are full-screen app surfaces (video conference room) that own their
 * own internal layout and should not be framed by the standard content column.
 */
const FLUSH_PREFIXES: readonly string[] = ['/conference/'];

const isFlush = (pathname: string) => FLUSH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Routes that lay themselves out as panes which scroll on their own: History's list
 * beside the conversation it opened. Matched as the route and everything under it,
 * because the list and the conversation are one screen.
 *
 * Like the flush routes they get the whole content area with no padding or measure —
 * the panes draw their own. Unlike them the frame is pinned to the viewport only from
 * `lg`: below it the content is always narrower than the two-pane layout needs, the
 * screen is a single page, and the BODY should scroll so a phone's browser chrome can
 * collapse as it does everywhere else.
 */
const PANED_ROUTES: readonly Route[] = ['/history'];

const isPaned = (pathname: string) =>
  PANED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

const SIDEBAR_WIDTH_KEY = 'chatofy.sidebar-width';
const SIDEBAR_WIDTH_DEFAULT = 256; // 16rem, the primitive's own default

export function AppChrome({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode;
  /** The reader's last choice, from the `sidebar_state` cookie; open when unset. */
  defaultOpen?: boolean;
}) {
  const pathname = usePathname();

  /*
    The reader's choice, seeded from the cookie and changed by every toggle — the
    primitive writes the cookie on every toggle too, so a reload and a client-side
    navigation land on the same answer. On a route that asks for a rail the toggle is
    also held for that route alone, stored with its pathname and derived away on
    navigation, so no effect has to reset it.
  */
  const [preferred, setPreferred] = React.useState(defaultOpen);
  const [override, setOverride] = React.useState<{ pathname: string; open: boolean }>();
  const rail = asksForRail(pathname);
  const open = override?.pathname === pathname ? override.open : rail ? false : preferred;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setPreferred(next);
      if (rail) setOverride({ pathname, open: next });
    },
    [pathname, rail],
  );

  // The width the reader dragged the sidebar to. It rides on the primitive's own CSS
  // variable, so the sidebar, its gap and the page beside it all follow one number.
  const sidebarWidth = useStoredWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_DEFAULT, 200, 360);

  return (
    <ChromeSlotsProvider>
      <SidebarProvider
        open={open}
        onOpenChange={setOpen}
        style={{ '--sidebar-width': `${sidebarWidth.width}px` } as React.CSSProperties}
      >
        <AppSidebar resize={sidebarWidth} />
        <ChromeContent pathname={pathname}>{children}</ChromeContent>
      </SidebarProvider>
    </ChromeSlotsProvider>
  );
}

/**
 * Everything right of the sidebar, plus the mobile tab bar — split out because it
 * reads the slots context the frame provides.
 *
 * The tab bar is not drawn in the conference room, which owns the whole screen, nor
 * while a screen holds `useImmersiveChrome(true)`. Where it is drawn, the content is
 * padded by its height plus the safe-area inset below `md`, so the last row of a page
 * is never under it.
 */
function ChromeContent({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const immersive = useChromeSlots()?.immersive ?? false;
  const tabBar = !isFlush(pathname) && !immersive;

  return (
    <>
      {/*
        `SidebarInset` renders the `<main>`, so this is the skip link's target.
        `tabIndex={-1}` is what lets focus actually land here — without it the fragment
        changes, focus stays in the nav, and the skip link looks implemented while doing
        nothing.

        Flush routes (conference room) cap SidebarInset at exactly h-svh so the chain of
        flex-1/h-full inside resolves against a fixed height instead of the
        SidebarProvider's min-h-svh which can grow with content. overflow-hidden on
        SidebarInset prevents the body from ever scrolling.
      */}
      <SidebarInset
        id="main"
        tabIndex={-1}
        className={cn(
          isFlush(pathname)
            ? 'h-svh overflow-hidden'
            : isPaned(pathname)
              ? 'lg:h-svh lg:overflow-hidden'
              : undefined,
          tabBar && 'max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        <AppTopbar />
        {/* `min-h-0` so a screen that wants to fill the viewport can: without it a flex
            child's implicit min-height is its content, and a transcript asking for the
            leftover space gets its own height back instead. */}
        {isFlush(pathname) ? (
          <div className="flex w-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        ) : isPaned(pathname) ? (
          <div className="flex w-full min-h-0 flex-1 flex-col">{children}</div>
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
      {tabBar ? <MobileTabBar /> : null}
    </>
  );
}
