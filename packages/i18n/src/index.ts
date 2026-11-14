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
 * `apps/web` and `apps/mobile` both read it; what they say identically lives under
 * `common.*`. Web's React provider stays in the app; when a second DOM surface
 * adopts, that provider moves behind a `/react` subpath here, mirroring
 * `@chatofy/ui/react`.
 *
 * All three locales ship from here, `vi.ts` and `zh.ts` typed `Messages` so the
 * compiler names every key either forgets. None is loaded lazily: the whole dictionary is a few kilobytes of
 * strings, and splitting it would buy nothing while adding a way for a subtree to
 * render before its words arrive.
 */
export { en, type MessageKey, type Messages } from './en.js';
export { vi } from './vi.js';
export { zh } from './zh.js';
export { createTranslator, type Translate, type Vars } from './t.js';
export { meetingDuration, meetingLanguages, meetingParticipants } from './meeting-summary.js';

/** The locales this product ships. The switcher and the cookie both read from this. */
export const LOCALES = ['en', 'vi', 'zh'] as const;

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

/**
 * The BCP-47 tag a document in this locale declares in `lang`.
 *
 * `zh` alone names no script, and a browser picks CJK glyph shapes by script and
 * region: without `-CN` a Simplified Chinese page may render with Japanese or
 * Traditional glyph variants. `en` and `vi` have nothing to disambiguate.
 */
const HTML_LANG: Record<Locale, string> = { en: 'en', vi: 'vi', zh: 'zh-CN' };

export function htmlLang(locale: Locale): string {
  return HTML_LANG[locale];
}

/**
 * The inverse of `htmlLang`: reads a document's `lang` back to a locale. Only the
 * primary subtag counts, so `zh-CN` (what `htmlLang` writes) and a bare `zh` agree.
 */
export function localeFromHtmlLang(lang: string | null | undefined): Locale | undefined {
  return asLocale(lang?.split('-')[0]);
}
