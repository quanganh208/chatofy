import type { Route } from 'next';
import { LayoutDashboard, Mic, type LucideIcon } from 'lucide-react';
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
 * That is deliberate and it is the schedule for this list: `/dashboard` joined it with
 * the route itself, and `/preferences` and `/account` join when they exist. A stub page would
 * satisfy the compiler and ship a nav item that leads nowhere, which is worse than a
 * shorter list.
 *
 * `/translate/live` and `/translate/baseline` are NOT here and never will be. They are
 * the continuous-mode experiment and the latency baseline — reachable by URL, linked
 * from nothing. Listing them would say they are part of the product.
 */
export interface NavItem {
  /** `Route`, so an address this app does not have is a compile error, not a 404. */
  href: Route;
  labelKey: MessageKey;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', labelKey: 'web.chrome.navDashboard', icon: LayoutDashboard },
  { href: '/translate', labelKey: 'web.chrome.navTranslate', icon: Mic },
];
