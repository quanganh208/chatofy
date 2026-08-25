'use client';

import * as React from 'react';
import { createTranslator, DEFAULT_LOCALE, en, type Locale, type Translate } from '@chatofy/i18n';

/**
 * The locale, handed down from the server.
 *
 * **The locale is resolved on the SERVER and passed in, never read from the browser
 * here.** That is the whole design, and it is the opposite of how the theme works
 * two files away — `app/layout.tsx` reads `localStorage` in a pre-paint script and
 * accepts a hydration warning for it.
 *
 * That pattern cannot be copied for language. A theme is one class attribute:
 * suppressible, and wrong for a single frame at worst. A locale is the text content
 * of the entire tree. Resolve it on the client and the server renders English while
 * hydration renders Vietnamese — a whole-page mismatch, a visible flash of the wrong
 * language on every load, and no `suppressHydrationWarning` scope that covers it.
 *
 * So the switcher writes a cookie and calls `router.refresh()`. It does not flip a
 * value in this context.
 */

const DICTIONARIES: Record<Locale, typeof en> = {
  en,
  // English until the Vietnamese dictionary is written; `Messages` typing means it
  // cannot be partially filled in.
  vi: en,
};

interface LocaleContextValue {
  locale: Locale;
  t: Translate;
}

const LocaleContext = React.createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({
  locale = DEFAULT_LOCALE,
  children,
}: {
  locale?: Locale;
  children: React.ReactNode;
}) {
  // Rebuilt only when the locale actually changes, which — because the switcher
  // goes through the server — means once per navigation at most.
  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, t: createTranslator(DICTIONARIES[locale]) }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Strings for a client component.
 *
 * Throws outside the provider rather than falling back to English. A silent
 * fallback would render correctly today — the locale is a constant — and then
 * silently render the wrong language for a subtree the day it is not, which is the
 * kind of bug that is invisible until someone reports the page is half translated.
 */
export function useTranslate(): Translate {
  const value = React.useContext(LocaleContext);
  if (!value) throw new Error('useTranslate must be used inside <LocaleProvider>');
  return value.t;
}

/** The active locale, for the switcher and for anything formatting a date or number. */
export function useLocale(): Locale {
  const value = React.useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside <LocaleProvider>');
  return value.locale;
}
