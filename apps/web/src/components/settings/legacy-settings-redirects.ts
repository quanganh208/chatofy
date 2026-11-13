import type { NextConfig } from 'next';
import { settingsDialogHref } from './settings-dialog-url';
import type { SettingsTabId } from './settings-tab-ids';

type Redirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number];

/**
 * Where the retired settings routes go, read by `next.config.ts`: the Settings dialog
 * on its tab, over `/translate/one-way` — the page `/translate` itself opens, named
 * directly so an old address costs one redirect rather than two.
 *
 * Settings stopped being pages and became one dialog over whatever page is open, so
 * every old address — `/settings`, each of its seven sections, `/account` and
 * `/preferences` — lands on the tab that now holds what that page held.
 *
 * Config redirects rather than `redirect()` in a page: they run before the filesystem
 * and before `proxy.ts`, so an old bookmark costs one redirect and no render, and a
 * signed-out visitor is sent to `/login?next=/translate/one-way?settings=…`. Next carries the
 * request's query string across and merges it with the destination's, so Polar's
 * success URL `/settings/billing?checkout=done` arrives as
 * `/translate/one-way?checkout=done&settings=billing` and Billing still reads its return.
 * The browser keeps a `#fragment`.
 *
 * Every rule is temporary (307), including `/account` and `/preferences`, which used
 * to answer 308: what each old address opens is a product choice that has now changed
 * once already, and a browser caches a permanent redirect indefinitely.
 */
const LEGACY_TABS: readonly (readonly [source: string, tab: SettingsTabId])[] = [
  ['/settings', 'general'],
  ['/settings/appearance', 'general'],
  ['/settings/audio', 'translation'],
  ['/settings/defaults', 'translation'],
  ['/settings/ai-context', 'ai-context'],
  ['/settings/profile', 'account'],
  ['/settings/security', 'account'],
  ['/settings/billing', 'billing'],
  // Credits and the plan were the old Account page's main content, and the mobile
  // app's buy link and Polar returns opened before `/settings/billing` still use it.
  ['/account', 'billing'],
  ['/preferences', 'general'],
];

/** The page the dialog opens over when an old address is followed. */
export const LEGACY_SETTINGS_LANDING = '/translate/one-way';

export const LEGACY_SETTINGS_REDIRECTS: readonly Redirect[] = LEGACY_TABS.map(([source, tab]) => ({
  source,
  destination: settingsDialogHref(tab, { pathname: LEGACY_SETTINGS_LANDING }),
  permanent: false,
}));
