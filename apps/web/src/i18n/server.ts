import { cookies, headers } from 'next/headers';
import {
  asLocale,
  createTranslator,
  en,
  vi,
  type Locale,
  type Messages,
  type Translate,
} from '@chatofy/i18n';
import { LOCALE_COOKIE } from './locale-cookie';
import { negotiateLocale } from './negotiate';

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
 * Resolution lives in {@link getLocale} and nowhere else, which is what the seam was
 * for. Every caller already went through it, so making it read a cookie changed no
 * call site's logic — only their `await`.
 *
 * **Reading `cookies()` opts the route into dynamic rendering.** That is accepted and
 * recorded so nobody "fixes" it: the landing page stops being prerendered, which for
 * self-hosted SSR at this traffic is not a cost worth a URL-prefix scheme. It is also
 * why every route group has an error boundary — a route that resolves at request time
 * is a route that can fail at request time.
 */

/**
 * The locale this request renders in.
 *
 * Three steps, in this order and for these reasons:
 *
 * 1. **the cookie**, if it names a locale this product has. An explicit choice wins
 *    over the browser's preference forever, including when they disagree.
 * 2. **`Accept-Language`**, on a first visit. A Vietnamese reader should not have to
 *    find a switcher to read Vietnamese.
 * 3. **English**, when neither answers.
 *
 * Never the client. Locale is the text content of the whole tree, so resolving it in
 * the browser means the server renders one language and hydration renders the other —
 * a whole-page mismatch and a visible flash of the wrong language on every load. The
 * theme two files away does exactly that on purpose, and it is the wrong template
 * here: a theme is one class attribute.
 */
export async function getLocale(): Promise<Locale> {
  const stored = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  if (stored) return stored;
  return negotiateLocale((await headers()).get('accept-language'));
}

/** Every locale's dictionary. `vi` is typed as `Messages`, so it cannot drift from `en`. */
/**
 * `Messages`, not `typeof en`. The English literal's type is its exact strings, so
 * `Record<Locale, typeof en>` would demand that Vietnamese say "Light" too.
 */
const DICTIONARIES: Record<Locale, Messages> = { en, vi };

/**
 * A reader bound to this request's locale.
 *
 * Not memoised. `createTranslator` closes over a dictionary and does no work, and a
 * cache keyed on a value that is about to become per-request is a bug waiting for
 * the phase that makes it one.
 */
export async function getT(locale?: Locale): Promise<Translate> {
  return createTranslator(DICTIONARIES[locale ?? (await getLocale())]);
}
