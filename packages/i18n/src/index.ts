/**
 * Strings, and the reader for them. No React, no DOM, no dependencies.
 *
 * The same constraints as `packages/ui`'s root entry, for the same reasons: Metro
 * has to be able to import this if mobile ever adopts it, and the extension popup
 * has to be able to import it without pulling a framework in. Product copy in a
 * component library would be the "primitive that knows what a meeting is" mistake
 * `docs/design-guidelines.md` names, which is why this is its own package rather
 * than a corner of `@chatofy/ui`.
 *
 * `apps/web` is the only consumer today. Its React provider stays in the app; when
 * a second DOM surface adopts, that provider moves behind a `/react` subpath here,
 * mirroring `@chatofy/ui/react`.
 *
 * Vietnamese arrives in a later phase as `vi.ts`, typed `Messages` so the compiler
 * names every key it forgets.
 */
export { en, type MessageKey, type Messages } from './en.js';
export { createTranslator, type Translate, type Vars } from './t.js';

/** The locales this product ships. The switcher and the cookie both read from this. */
export const LOCALES = ['en', 'vi'] as const;

export type Locale = (typeof LOCALES)[number];

/** The fallback when nothing is stored and nothing is negotiable. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Narrows an untrusted string — a cookie value, a `?lang=`, an `Accept-Language`
 * fragment — to a locale this product has.
 *
 * Returns `undefined` rather than the default so a caller can tell "absent" from
 * "explicitly English", which the negotiation order depends on.
 */
export function asLocale(value: string | null | undefined): Locale | undefined {
  return LOCALES.find((locale) => locale === value);
}
