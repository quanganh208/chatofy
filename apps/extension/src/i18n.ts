import {
  DEFAULT_LOCALE,
  createTranslator,
  en,
  htmlLang,
  localeFromHtmlLang,
  vi,
  zh,
  type Locale,
  type MessageKey,
  type Messages,
  type Translate,
} from '@chatofy/i18n';

/**
 * The extension's words, in the browser's language.
 *
 * Read from `navigator.languages`, not from the account. The account's preferences
 * document — the one thing the extension syncs — carries no interface language, and
 * the `locale` on `/auth/me` is the language its MAIL is written in, read only after
 * a network round trip. Every context here (popup, overlay, worker, offscreen page,
 * microphone page) has `navigator` synchronously and agrees on its answer, so a
 * failure produced in the worker and shown in the overlay is in one language, and
 * nothing renders English first and then flips.
 *
 * Resolved once, at module load: an MV3 page lives seconds, and a browser language
 * change restarts the extension's pages anyway.
 */

/** `Messages`, not `typeof en`, so Vietnamese is not required to say "Start". */
const DICTIONARIES: Record<Locale, Messages> = { en, vi, zh };

/**
 * The first of the reader's preferred languages this product ships, by primary
 * subtag — `vi-VN` is Vietnamese, any `zh-*` is the Simplified Chinese we have.
 */
export function negotiateLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const locale = localeFromHtmlLang(tag.toLowerCase());
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

export const locale: Locale = negotiateLocale(browserLanguages());

export const t: Translate = createTranslator(DICTIONARIES[locale]);

/** The BCP-47 tag for `Intl.*` and a document's `lang`. */
export const intlLocale: string = htmlLang(locale);

/** Whether a string from markup names a key, so `data-i18n` cannot smuggle one in. */
export function isMessageKey(value: string | undefined): value is MessageKey {
  return value !== undefined && Object.hasOwn(en, value);
}

/**
 * Fills every `[data-i18n]` element's text from the dictionary and sets `lang`.
 *
 * For the parts of a page that live in static HTML on purpose — the recording
 * notice must render even if no script runs — so the English written there stays
 * as the no-script fallback and this replaces it the moment a script does run.
 * Text only, never markup: an element with inline children is split into one
 * keyed span per fragment instead.
 */
export function localizeDocument(root: Document = document): void {
  root.documentElement.lang = intlLocale;
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (isMessageKey(key)) node.textContent = t(key);
  }
}
