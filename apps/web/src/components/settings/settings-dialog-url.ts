import {
  FIRST_SETTINGS_TAB,
  isSettingsTabId,
  SETTINGS_MENU,
  SETTINGS_PARAM,
  type SettingsTabId,
} from './settings-tab-ids';

/**
 * The Settings dialog's URL contract, as pure functions over a path, a query and a
 * hash — so the hook, the legacy redirects in `next.config.ts` and the specs build
 * and read `?settings=` the same way and no caller writes the query by hand.
 *
 * `?settings=<tab>` opens the dialog on that tab; `?settings=menu` (or an empty or
 * unknown value) opens it on its list of tabs; no parameter means it is closed.
 * Everything else in the query belongs to the page underneath and is kept.
 *
 * Dependency-free beyond `settings-tab-ids.ts`, because the config imports it.
 */

/**
 * What the dialog shows: one tab, or the list of tabs (`null`). The list is a phone's
 * first screen; a wide screen renders {@link FIRST_SETTINGS_TAB} for it.
 */
export type SettingsDialogView = SettingsTabId | null;

/**
 * Query parameters that only mean something while the dialog is open, removed with
 * `settings` when it closes. `checkout=done` is Polar's return to Billing: left on
 * the page underneath, reopening Billing would announce the same payment again.
 */
const CHECKOUT_RETURN_PARAM = 'checkout';
const DIALOG_OWNED_PARAMS: readonly string[] = [SETTINGS_PARAM, CHECKOUT_RETURN_PARAM];

/** The dialog's state as `?settings=` says it: closed (`undefined`), the list, or a tab. */
export function readSettingsDialog(
  params: Pick<URLSearchParams, 'get'> | null | undefined,
): SettingsDialogView | undefined {
  const value = params?.get(SETTINGS_PARAM);
  if (value === null || value === undefined) return undefined;
  return isSettingsTabId(value) ? value : null;
}

interface UrlParts {
  pathname: string;
  /** With or without the leading `?`. */
  search?: string;
  /** With or without the leading `#`. */
  hash?: string;
}

function join(pathname: string, params: URLSearchParams, hash = ''): string {
  const query = params.toString();
  const fragment = hash.replace(/^#/, '');
  return `${pathname}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * The address of `base` with the dialog open on `view` — the typed link builder.
 * Every other parameter and the hash are kept, so the page underneath is unchanged.
 */
export function settingsDialogHref(view: SettingsDialogView, base: UrlParts): string {
  const params = new URLSearchParams(base.search ?? '');
  params.set(SETTINGS_PARAM, view ?? SETTINGS_MENU);
  return join(base.pathname, params, base.hash);
}

/**
 * The address of `base` switched to `view` inside the open dialog. Polar's
 * `checkout=done` is dropped: it is read once, by Billing as the dialog lands on it,
 * and kept it would announce the same payment again every time Billing is reopened.
 */
export function settingsDialogSwitchHref(view: SettingsDialogView, base: UrlParts): string {
  const params = new URLSearchParams(base.search ?? '');
  params.delete(CHECKOUT_RETURN_PARAM);
  return settingsDialogHref(view, { ...base, search: params.toString() });
}

/** The address of `base` with the dialog closed: its own parameters removed, the rest kept. */
export function withoutSettingsDialog(base: UrlParts): string {
  const params = new URLSearchParams(base.search ?? '');
  for (const key of DIALOG_OWNED_PARAMS) params.delete(key);
  return join(base.pathname, params, base.hash);
}

/** The tab a view renders in the pane: the named one, or the first for the list. */
export function paneTabFor(view: SettingsDialogView): SettingsTabId {
  return view ?? FIRST_SETTINGS_TAB;
}
