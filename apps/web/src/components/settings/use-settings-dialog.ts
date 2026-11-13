'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { FIRST_SETTINGS_TAB, type SettingsTabId } from './settings-tab-ids';
import {
  readSettingsDialog,
  settingsDialogHref,
  settingsDialogSwitchHref,
  withoutSettingsDialog,
  type SettingsDialogView,
} from './settings-dialog-url';

/**
 * Open, switch and close the Settings dialog — the one way any caller does.
 *
 * ## The URL is the state
 *
 * `?settings=<tab>` on whatever page the reader is on. Opening PUSHES that onto the
 * current address, so Back closes the dialog; switching tabs inside it REPLACES, so
 * Back does not walk through every tab looked at. Esc and ✕ close by going back when
 * this hook pushed the entry, and otherwise (a link or redirect that arrived with
 * `?settings=` already on it) by replacing the address with one that has no dialog —
 * either way the history ends where it was before the dialog opened.
 *
 * ## Native history, not `router.push`
 *
 * `window.history.pushState` and `replaceState` are integrated with the App Router
 * (`useSearchParams` follows them) and, unlike `router.push`, they do not ask the
 * server for the page again. The page underneath is not re-rendered from the server,
 * not remounted, and keeps every bit of its state — a running conversation included.
 *
 * Which entries this hook pushed is recorded in the entry's own `history.state`, so it
 * survives a reload and is shared by every caller without a context.
 */
export interface UseSettingsDialog {
  /** Whether `?settings=` is on the address. */
  isOpen: boolean;
  /** What the open dialog shows: a tab, or the list of tabs (`null`). `null` when closed. */
  view: SettingsDialogView;
  /** {@link openSettingsDialog} */
  open: (tab?: SettingsTabId) => void;
  /** {@link showSettingsDialog} */
  show: (view: SettingsDialogView) => void;
  /** {@link closeSettingsDialog} */
  close: () => void;
}

/** The `history.state` key marking an entry this hook pushed. */
const PUSHED_KEY = 'chatofySettingsDialog';

/** `sm`, where the tab list starts sitting beside the pane. */
const WIDE_QUERY = '(min-width: 40rem)';

function here() {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

function pushedHere(): boolean {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && PUSHED_KEY in state;
}

function wide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
}

/** Switch the dialog in place, keeping whether this entry was one the hook pushed. */
function replaceView(view: SettingsDialogView): void {
  window.history.replaceState(
    pushedHere() ? { [PUSHED_KEY]: true } : null,
    '',
    settingsDialogSwitchHref(view, here()),
  );
}

/**
 * Open the dialog over the current page. Without a tab it opens on the list on a phone
 * and on the first tab where the list sits beside the pane. Already open, it switches
 * instead of stacking a second history entry.
 *
 * A plain function rather than a hook, so an entry point (the sidebar, a menu item)
 * opens Settings without subscribing to the query string it is about to change.
 */
export function openSettingsDialog(tab?: SettingsTabId): void {
  const view = tab ?? (wide() ? FIRST_SETTINGS_TAB : null);
  if (readSettingsDialog(new URLSearchParams(window.location.search)) !== undefined) {
    replaceView(view);
    return;
  }
  window.history.pushState({ [PUSHED_KEY]: true }, '', settingsDialogHref(view, here()));
}

/** Switch the open dialog to a tab, or to the list (`null`), without a history entry. */
export function showSettingsDialog(view: SettingsDialogView): void {
  replaceView(view);
}

/** Close the dialog, leaving the page underneath at the address it had before it opened. */
export function closeSettingsDialog(): void {
  if (readSettingsDialog(new URLSearchParams(window.location.search)) === undefined) return;
  if (pushedHere()) {
    window.history.back();
    return;
  }
  window.history.replaceState(null, '', withoutSettingsDialog(here()));
}

/** Whether the tab list sits beside the pane at the current viewport (`sm` and up). */
export function settingsListBesidePane(): boolean {
  return wide();
}

/** The dialog's state, read from the address, plus the three ways to change it. */
export function useSettingsDialog(): UseSettingsDialog {
  const current = readSettingsDialog(useSearchParams());
  return useMemo(
    () => ({
      isOpen: current !== undefined,
      view: current ?? null,
      open: openSettingsDialog,
      show: showSettingsDialog,
      close: closeSettingsDialog,
    }),
    [current],
  );
}
