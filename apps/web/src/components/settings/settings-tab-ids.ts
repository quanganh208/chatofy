/**
 * The ids of the five Settings tabs and the `?settings=` URL contract, with no imports.
 *
 * Dependency-free on purpose: `next.config.ts` builds the legacy-route redirects from
 * these, and the config runs in plain Node, where an icon library or a dictionary
 * has no business loading. Labels and icons are in `settings-tabs.ts`.
 *
 * The ids are the URL contract — `?settings=billing` is what Polar's success URL
 * lands on through the `/settings/billing` redirect — so renaming one breaks every
 * bookmark and redirect that names it.
 */
export const SETTINGS_TAB_IDS = [
  'general',
  'translation',
  'ai-context',
  'account',
  'billing',
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/** The query parameter whose presence means "the Settings dialog is open". */
export const SETTINGS_PARAM = 'settings';

/**
 * The value of `?settings=` that opens the dialog on its list of tabs rather than on
 * one of them — what a phone shows first. A wide screen has the list beside the pane
 * at all times, so there it renders {@link FIRST_SETTINGS_TAB}. An empty or unknown
 * value reads the same way, so a mangled link still opens Settings.
 */
export const SETTINGS_MENU = 'menu';

/** The tab a wide screen shows when the URL names none. */
export const FIRST_SETTINGS_TAB: SettingsTabId = 'general';

export function isSettingsTabId(value: string): value is SettingsTabId {
  return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}
