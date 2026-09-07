import type { Route } from 'next';
import { History, Mic, SlidersHorizontal, User, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';

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
export const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  [
    { href: '/translate', labelKey: 'web.chrome.navTranslate', icon: Mic },
    { href: '/history', labelKey: 'web.chrome.navHistory', icon: History },
  ],
  [
    { href: '/preferences', labelKey: 'web.chrome.navPreferences', icon: SlidersHorizontal },
    { href: '/account', labelKey: 'web.chrome.navAccount', icon: User },
  ],
];

/**
 * The same items, flat — what the topbar looks a route title up in.
 *
 * Derived rather than written twice: a second literal list is a second thing to keep
 * in sync, and the failure would be a route with no title rather than anything loud.
 */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flat();
