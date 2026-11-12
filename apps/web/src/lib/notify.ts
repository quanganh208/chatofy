import { asLocale, createTranslator, en, vi, type MessageKey } from '@chatofy/i18n';
import { toast } from '@chatofy/ui/react';

/**
 * Feedback after an action, through the one toast host `AppToaster` mounts.
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

const base = ({ id, description }: NotifyOptions) => ({
  ...(id === undefined ? {} : { id }),
  ...(description === undefined ? {} : { description }),
});

export const notify = {
  success(message: string, options: NotifyOptions & { undo?: () => void } = {}) {
    const { undo, ...rest } = options;
    return toast.success(message, {
      ...base(rest),
      ...(undo ? { action: { label: label('web.chrome.undo'), onClick: undo } } : {}),
    });
  },

  error(message: string, options: NotifyOptions & { retry?: () => void } = {}) {
    const { retry, ...rest } = options;
    return toast.error(message, {
      ...base(rest),
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      ...(retry ? { action: { label: label('web.chrome.retry'), onClick: retry } } : {}),
    });
  },

  info(message: string, options: NotifyOptions = {}) {
    return toast.info(message, base(options));
  },

  /** Takes one toast down by id, or every toast with no argument. */
  dismiss(id?: string | number) {
    toast.dismiss(id);
  },
};
