import type { Locale } from '@chatofy/i18n';

/**
 * Where the chosen language is kept, and for how long.
 *
 * Read on the server so the first byte is already in the right language, and written
 * on the client by the switcher — which is why it is **not** `httpOnly`. That is a
 * deliberate exception to the default and it costs nothing: the value is one of two
 * public strings, it authorises nothing, and a page that can already read the whole
 * document can already see which language it is in.
 *
 * `SameSite=Lax` so following a link into the app carries the choice; `Path=/` so the
 * marketing page and the app agree.
 *
 * A year, because a language preference does not go stale. Session-scoped would mean
 * a returning reader is re-negotiated from `Accept-Language` and quietly moved back to
 * the language they just chose against.
 */
export const LOCALE_COOKIE = 'locale';

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The exact `document.cookie` write, so the switcher and any test agree on it. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
