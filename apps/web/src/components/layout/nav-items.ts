import type { Route } from 'next';
import {
  ArrowLeftRight,
  BookOpen,
  History,
  Mic,
  Settings,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';
import { SETTINGS_SECTIONS } from '@/components/settings/settings-sections';

/**
 * The product navigation, in one list, read by the sidebar, the topbar's breadcrumb
 * and the mobile tab bar.
 *
 * The breadcrumb comes from here rather than from the page, and that is the whole
 * reason this file exists rather than an array inside the sidebar. A layout receives
 * nothing from the page below it, so the alternative was every page announcing its own
 * place into a slot — a second list of route names, kept in sync by nobody. A page
 * still appends what only it knows (a conversation's title) through `TopbarCrumb`.
 *
 * ## Items land with their routes
 *
 * `typedRoutes: true` rejects an `href` to a route this app does not have, **at build**.
 * That is deliberate and it is the schedule for this list: an item joins with its route
 * and leaves with it. A stub page would satisfy the compiler and ship a nav item that
 * leads nowhere, which is worse than a shorter list.
 */
export interface NavItem {
  /** `Route`, so an address this app does not have is a compile error, not a 404. */
  href: Route;
  labelKey: MessageKey;
  icon: LucideIcon;
}

export interface NavGroup {
  /** The caption over the group in the sidebar, and the first crumb in the topbar. */
  labelKey: MessageKey;
  items: readonly NavItem[];
}

/**
 * Two captioned groups, split by what the item acts on: a conversation you are about
 * to have, or the record of ones you had.
 *
 * Captions arrived with the Linear-style frame. With seven items in two groups the
 * separator was enough; with Settings moved to the footer the captions are what tell
 * "Translate" from "Library" at a glance, and they double as the breadcrumb's first
 * crumb, so the topbar and the sidebar say where you are in the same words.
 */
const GROUPS: readonly NavGroup[] = [
  {
    labelKey: 'web.chrome.navGroupTranslate',
    items: [
      // One-way and two-way are separate pages, so separate items: which kind of
      // conversation this is gets chosen before the screen opens, not inside it.
      { href: '/translate/one-way', labelKey: 'web.chrome.navTranslate', icon: Mic },
      {
        href: '/translate/two-way',
        labelKey: 'web.chrome.navTranslateTwoWay',
        icon: ArrowLeftRight,
      },
      { href: '/conference', labelKey: 'web.chrome.navConference', icon: Video },
    ],
  },
  {
    labelKey: 'web.chrome.navGroupLibrary',
    items: [
      { href: '/history', labelKey: 'web.chrome.navHistory', icon: History },
      { href: '/glossary', labelKey: 'web.chrome.navGlossary', icon: BookOpen },
    ],
  },
];

/**
 * Where the footer's Settings entry leads, and the routes it stands for.
 *
 * Not a sidebar group: settings are reached from the footer beside who you are, the
 * way Linear and Notion place them. The group still exists for the breadcrumb and for
 * marking the footer entry active. `href` is the first section rather than `/settings`
 * itself: that bare path is only a redirect, and `typedRoutes` knows pages, not redirects.
 */
export const SETTINGS_ITEM: NavItem = {
  href: '/settings/appearance',
  labelKey: 'common.nav.settings',
  icon: Settings,
};

const SETTINGS_GROUP: NavGroup = {
  labelKey: 'common.nav.settings',
  // The settings pages themselves, so the breadcrumb reads Settings › Appearance in the
  // words the settings sub-navigation uses. `settings-sections.ts` owns the list.
  items: SETTINGS_SECTIONS.map(({ href, labelKey, icon }) => ({ href, labelKey, icon })),
};

const ALL_GROUPS: readonly NavGroup[] = [...GROUPS, SETTINGS_GROUP];

/** The groups the sidebar draws. Settings is not among them; see `SETTINGS_ITEM`. */
export function navGroups(): readonly NavGroup[] {
  return GROUPS;
}

/**
 * Every item a route can belong to, flat. Built once: the sidebar marks the active
 * item by IDENTITY against what `navItemFor` returns, so both must hand out the same
 * objects.
 */
const ITEMS = ALL_GROUPS.flatMap((group) => group.items);

export function navItems(): readonly NavItem[] {
  return ITEMS;
}

/**
 * The nav item a path belongs to: its own `href`, or any route nested under it.
 *
 * Exact matching left `/history/<id>` with no breadcrumb — so no `<h1>` on the page —
 * and no active item in the sidebar, although the reader is plainly still in History.
 * The `/` boundary keeps a sibling such as `/historyx` from matching.
 */
export function navItemFor(
  pathname: string,
  items: readonly NavItem[] = navItems(),
): NavItem | undefined {
  return items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

/** Where a path sits: its group and its item, or nothing for a route under no item. */
export function navPlaceFor(pathname: string): { group: NavGroup; item: NavItem } | undefined {
  for (const group of ALL_GROUPS) {
    const item = navItemFor(pathname, group.items);
    if (item) return { group, item };
  }
  return undefined;
}

/** True on any route the footer's Settings entry stands for. */
export function isSettingsPath(pathname: string): boolean {
  return navItemFor(pathname, SETTINGS_GROUP.items) !== undefined;
}
