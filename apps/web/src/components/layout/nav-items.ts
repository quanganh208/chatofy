import type { Route } from 'next';
import { History, Mic, SlidersHorizontal, User, Video, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';
import { isConferenceEnabled } from '@/config/feature-flags';

/**
 * The product navigation, in one list, read by both the sidebar and the topbar.
 *
 * The topbar title comes from here rather than from the page, and that is the whole
 * reason this file exists rather than an array inside the sidebar. A layout receives
 * nothing from the page below it, so the alternative was every page announcing its own
 * title into a slot — a second list of route names, kept in sync by nobody.
 *
 * ## Items land with their routes
 *
 * `typedRoutes: true` rejects an `href` to a route this app does not have, **at build**.
 * That is deliberate and it is the schedule for this list: an item joins with its route
 * and leaves with it. A stub page would satisfy the compiler and ship a nav item that
 * leads nowhere, which is worse than a shorter list — and the same rule ran in reverse
 * when `/dashboard` was deleted and its entry went in the same commit, then again when
 * the two unlisted lab routes under `/translate` went.
 */
export interface NavItem {
  /** `Route`, so an address this app does not have is a compile error, not a 404. */
  href: Route;
  labelKey: MessageKey;
  icon: LucideIcon;
}

/**
 * Two groups, drawn with a separator between them and no caption over either.
 *
 * The caption question was left open in Phase 5 precisely until there were two groups
 * to tell apart, and now that there are, the answer is still no. `SidebarGroupLabel`
 * would put two words the reader skips above four items whose icons and labels already
 * say what they are — and collapsed to the rail the captions vanish while the separator
 * survives, so the separator is the part actually carrying the grouping. The mockup
 * draws it the same way.
 *
 * The split is by what the item acts on: the first group is the product, the second is
 * your settings. History was the reserved fifth item, and it arrived the way this file
 * says items arrive: with its route, at PDR milestone 6.
 */
const CONFERENCE_ITEM: NavItem = {
  href: '/conference',
  labelKey: 'web.chrome.navConference',
  icon: Video,
};

function buildGroups(conferenceEnabled: boolean): readonly (readonly NavItem[])[] {
  return [
    [
      { href: '/translate', labelKey: 'web.chrome.navTranslate', icon: Mic },
      ...(conferenceEnabled ? [CONFERENCE_ITEM] : []),
      { href: '/history', labelKey: 'web.chrome.navHistory', icon: History },
    ],
    [
      { href: '/preferences', labelKey: 'web.chrome.navPreferences', icon: SlidersHorizontal },
      { href: '/account', labelKey: 'web.chrome.navAccount', icon: User },
    ],
  ];
}

/**
 * Both lists, built once. The sidebar marks the active item by IDENTITY against
 * what `navItemFor` returns, so the two must hand out the same objects.
 */
const GROUPS_WITH_CONFERENCE = buildGroups(true);
const GROUPS_WITHOUT_CONFERENCE = buildGroups(false);
const ITEMS_WITH_CONFERENCE = GROUPS_WITH_CONFERENCE.flat();
const ITEMS_WITHOUT_CONFERENCE = GROUPS_WITHOUT_CONFERENCE.flat();

/**
 * Conferencing is listed only in a build that ships it. Its routes answer 404
 * otherwise (`app/(app)/conference/layout.tsx`), and an item that leads to a 404
 * is the stub-page failure the paragraph above rules out.
 *
 * A function of the flag rather than a constant so both states are testable
 * from one import; the default reads the build's own flag.
 */
export function navGroups(
  conferenceEnabled: boolean = isConferenceEnabled(),
): readonly (readonly NavItem[])[] {
  return conferenceEnabled ? GROUPS_WITH_CONFERENCE : GROUPS_WITHOUT_CONFERENCE;
}

/**
 * The same items, flat — what the topbar looks a route title up in.
 *
 * Derived rather than written twice: a second literal list is a second thing to keep
 * in sync, and the failure would be a route with no title rather than anything loud.
 */
export function navItems(conferenceEnabled: boolean = isConferenceEnabled()): readonly NavItem[] {
  return conferenceEnabled ? ITEMS_WITH_CONFERENCE : ITEMS_WITHOUT_CONFERENCE;
}

/**
 * The nav item a path belongs to: its own `href`, or any route nested under it.
 *
 * Exact matching left `/history/<id>` with no topbar title — so no `<h1>` on the
 * page — and no active item in the sidebar, although the reader is plainly still in
 * History. The `/` boundary keeps a sibling such as `/historyx` from matching.
 */
export function navItemFor(
  pathname: string,
  items: readonly NavItem[] = navItems(),
): NavItem | undefined {
  return items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
