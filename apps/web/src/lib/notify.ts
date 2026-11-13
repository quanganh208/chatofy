import { asLocale, createTranslator, en, vi, type MessageKey } from '@chatofy/i18n';
import { toast } from '@chatofy/ui/react';

/**
 * Feedback after an action, through the toast host `AppToaster` mounts — the page's,
 * or the one inside Settings while it is open (see `routeToastsToSettings`).
 *
 * Three verbs and no more, so every screen says "saved", "failed" and "note" alike:
 *
 * - `success` — four seconds, with an optional Undo.
 * - `error` — **stays until dismissed**, with an optional Retry. An error that leaves on
 *   its own is an error a reader looking away never saw.
 * - `info` — four seconds, nothing to press.
 *
 * Pass an `id` for anything that can fire repeatedly (an autosave): a toast with the
 * same id replaces the one on screen instead of stacking a column of "Saved".
 *
 * The Undo and Retry labels come from the dictionary of the language the page is in
 * (`<html lang>`, which the root layout sets from the resolved locale), so a caller
 * passes a callback, not a word. Callable from anywhere — an event handler, a hook's
 * catch — because it is not a hook.
 */
export interface NotifyOptions {
  /** Same id, same toast: a repeat replaces rather than stacks. */
  id?: string | number;
  /** A second, quieter line under the message. */
  description?: string;
}

const DICTIONARIES = { en, vi } as const;

function label(key: MessageKey): string {
  const locale =
    (typeof document !== 'undefined' ? asLocale(document.documentElement.lang) : undefined) ?? 'en';
  return createTranslator(DICTIONARIES[locale])(key);
}

/**
 * Which host a toast raised now belongs to.
 *
 * The page's host (`AppToaster`) sits outside the Settings dialog, and a modal traps
 * focus: a "Saved" toast raised by a change made in Settings would be pressable but
 * not reachable by Tab or Alt+T. So while Settings is open it mounts a second host
 * INSIDE the dialog, with its own sonner id, and every toast raised meanwhile is
 * routed there. Each host shows only its own toasts, so nothing is shown twice and
 * nothing moves between hosts: closing Settings takes its toasts down with it (an
 * Undo cannot come back on the page and run a second time).
 */
export const SETTINGS_TOASTER_ID = 'settings';
let routedTo: string | undefined;
const raisedInSettings = new Set<string | number>();

/** The Settings host announces itself on mount; on unmount its toasts are taken down. */
export function routeToastsToSettings(open: boolean): void {
  routedTo = open ? SETTINGS_TOASTER_ID : undefined;
  if (open) return;
  for (const id of raisedInSettings) toast.dismiss(id);
  raisedInSettings.clear();
}

const base = ({ id, description }: NotifyOptions) => ({
  ...(id === undefined ? {} : { id }),
  ...(description === undefined ? {} : { description }),
  ...(routedTo === undefined ? {} : { toasterId: routedTo }),
});

/** Remember a toast raised into the Settings host, so closing Settings can take it down. */
function track<T extends string | number>(id: T): T {
  if (routedTo !== undefined) raisedInSettings.add(id);
  return id;
}

export const notify = {
  success(message: string, options: NotifyOptions & { undo?: () => void } = {}) {
    const { undo, ...rest } = options;
    return track(
      toast.success(message, {
        ...base(rest),
        ...(undo ? { action: { label: label('web.chrome.undo'), onClick: undo } } : {}),
      }),
    );
  },

  error(message: string, options: NotifyOptions & { retry?: () => void } = {}) {
    const { retry, ...rest } = options;
    return track(
      toast.error(message, {
        ...base(rest),
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
        ...(retry ? { action: { label: label('web.chrome.retry'), onClick: retry } } : {}),
      }),
    );
  },

  info(message: string, options: NotifyOptions = {}) {
    return track(toast.info(message, base(options)));
  },

  /** Takes one toast down by id, or every toast with no argument. */
  dismiss(id?: string | number) {
    toast.dismiss(id);
  },
};
