/**
 * The whole translation mechanism, and it is deliberately this small.
 *
 * `next-intl` earns its place through routing middleware and navigation wrappers.
 * This project resolves the locale from a cookie with no URL segment, which
 * deletes both from the requirements — what is left is a lookup and a placeholder
 * substitution, and a dependency for that would be a dependency to maintain.
 *
 * No ICU. Vietnamese has no grammatical plural, so plural machinery would serve
 * only the English half of a handful of strings; those get two variants written by
 * hand. Dates and numbers use native `Intl.*`.
 *
 * Rich text is deliberately absent too. A sentence that wraps an element — "Already
 * have an account? <Link>Sign in</Link>" — is split into one key per fragment
 * rather than growing element interpolation. English and Vietnamese agree on order
 * for every such string in this product, so nothing needs reordering.
 */
import type { MessageKey, Messages } from './en.js';

/** Values substituted into `{name}` placeholders. Numbers are formatted by the caller. */
export type Vars = Readonly<Record<string, string | number>>;

/** Reads one string. Bound to a locale's dictionary by {@link createTranslator}. */
export type Translate = (key: MessageKey, vars?: Vars) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Binds a dictionary, returning the reader every call site uses.
 *
 * A key with no entry returns the KEY, not an empty string. A blank is invisible in
 * a screenshot and in review; a key is obviously wrong and says which one. This can
 * only happen through a raw string that bypassed `MessageKey` — app code is typed,
 * but a test passing a literal is not.
 *
 * A placeholder with no matching var is left as written, for the same reason: the
 * page shows `{name}` rather than a hole where a name should be.
 */
export function createTranslator(messages: Messages): Translate {
  return (key, vars) => {
    const template = messages[key] ?? key;
    if (!vars) return template;
    return template.replace(PLACEHOLDER, (whole, name: string) => {
      const value = vars[name];
      return value === undefined ? whole : String(value);
    });
  };
}
