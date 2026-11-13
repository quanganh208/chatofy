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
 * routed there. Each host shows only its own toasts, so nothing is shown twice.
 *
 * Closing Settings settles its toasts by kind:
 *
 * - A success or a note is taken down. It said something about what was just done
 *   in Settings, and its Undo must never come back on the page and run twice.
 * - An error still on screen moves to the page's host, same id and same Retry. An
 *   error stays until dismissed, and one raised by the page underneath while
 *   Settings was open — a conversation that failed — is the page's to show. Its
 *   raiser (`useErrorToast`) only raises again when the message changes, so taking
 *   it down would lose it for good.
 */
export const SETTINGS_TOASTER_ID = 'settings';
type Kind = 'success' | 'error' | 'info';
type ToastData = NonNullable<Parameters<typeof toast.success>[1]>;
let routedTo: string | undefined;
const raisedInSettings = new Map<
  string | number,
  { kind: Kind; message: string; data: ToastData }
>();

/** The Settings host announces itself on mount, and settles its toasts on unmount. */
export function routeToastsToSettings(open: boolean): void {
  routedTo = open ? SETTINGS_TOASTER_ID : undefined;
  if (open) return;
  const active = new Set(toast.getToasts().map((shown) => shown.id));
  for (const [id, { kind, message, data }] of raisedInSettings) {
    if (!active.has(id)) continue;
    if (kind === 'error') toast.error(message, { ...data, id, toasterId: undefined });
    else toast.dismiss(id);
  }
  raisedInSettings.clear();
}

/** One toast, into whichever host is current, remembered if that is Settings'. */
function raise(kind: Kind, message: string, data: ToastData): string | number {
  const routed = routedTo === undefined ? data : { ...data, toasterId: routedTo };
  const id = toast[kind](message, routed);
  if (routedTo !== undefined) raisedInSettings.set(id, { kind, message, data });
  // Raised on the page with an id Settings held: it is the page's now.
  else raisedInSettings.delete(id);
  return id;
}

const base = ({ id, description }: NotifyOptions) => ({
  ...(id === undefined ? {} : { id }),
  ...(description === undefined ? {} : { description }),
});

export const notify = {
  success(message: string, options: NotifyOptions & { undo?: () => void } = {}) {
    const { undo, ...rest } = options;
    return raise('success', message, {
      ...base(rest),
      ...(undo ? { action: { label: label('web.chrome.undo'), onClick: undo } } : {}),
    });
  },

  error(message: string, options: NotifyOptions & { retry?: () => void } = {}) {
    const { retry, ...rest } = options;
    return raise('error', message, {
      ...base(rest),
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      ...(retry ? { action: { label: label('web.chrome.retry'), onClick: retry } } : {}),
    });
  },

  info(message: string, options: NotifyOptions = {}) {
    return raise('info', message, base(options));
  },

  /** Takes one toast down by id, or every toast with no argument. */
  dismiss(id?: string | number) {
    if (id === undefined) raisedInSettings.clear();
    else raisedInSettings.delete(id);
    toast.dismiss(id);
  },
};
