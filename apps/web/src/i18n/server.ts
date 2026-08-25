import { createTranslator, DEFAULT_LOCALE, en, type Locale, type Translate } from '@chatofy/i18n';

/**
 * Strings for anything that runs on the server: a server component, and
 * `generateMetadata`.
 *
 * **This exists now, while the locale is a constant, precisely because it looks
 * unnecessary now.** React context is client-only, so a server file cannot call the
 * hook — and the tempting shortcut is to import `en` directly and index it. Every
 * one of those imports is a call site that would have to be found and rewritten the
 * moment the locale stops being a constant, which is exactly the rewrite building
 * this seam early is meant to prevent.
 *
 * When locale resolution lands, only the body of {@link getLocale} changes: it will
 * read the cookie, negotiate from `Accept-Language`, and fall back. Every caller
 * stays as written.
 */

/**
 * The locale this request renders in.
 *
 * Constant today. It becomes a cookie read plus `Accept-Language` negotiation, and
 * that change belongs here rather than at any call site.
 */
export function getLocale(): Locale {
  return DEFAULT_LOCALE;
}

/** Every locale's dictionary. `vi` joins it typed as `Messages`, so it cannot drift. */
const DICTIONARIES: Record<Locale, typeof en> = {
  en,
  // Vietnamese is written in a later phase. Until then it renders English rather
  // than a half-translated page, and `tsc` will name every key it is missing.
  vi: en,
};

/**
 * A reader bound to this request's locale.
 *
 * Not memoised. `createTranslator` closes over a dictionary and does no work, and a
 * cache keyed on a value that is about to become per-request is a bug waiting for
 * the phase that makes it one.
 */
export function getT(locale: Locale = getLocale()): Translate {
  return createTranslator(DICTIONARIES[locale]);
}
