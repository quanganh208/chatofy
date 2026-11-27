/**
 * A language's name inside a sentence, as opposed to on its own.
 *
 * `common.languageName.*` is written as a standalone label — a picker option, a
 * chip, a column header — so Vietnamese capitalises it ("Tiếng Việt"). Vietnamese
 * writes a language name in lower case mid-sentence ("dịch tiếng Việt sang tiếng
 * Anh"), and only the first letter changes: the proper noun after it ("Việt")
 * keeps its capital. English and Chinese write the same word in both positions.
 *
 * The locale is a parameter because a `Translate` is a bare lookup and does not
 * know which dictionary it is bound to.
 */
import { en, type MessageKey } from './en.js';
import type { Translate } from './t.js';

/** Locales are plain strings here so this module keeps no import cycle with the barrel. */
type LocaleTag = 'en' | 'vi' | 'zh';

/** Lower-cases the first letter of an already-named language when `locale` is Vietnamese. */
export function languageNameInSentence(locale: LocaleTag, name: string): string {
  if (locale !== 'vi' || name === '') return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * The name of the registry language `code` for use inside a sentence. A code with
 * no `common.languageName` entry comes back as written, like a missing key does.
 */
export function languageNameForSentence(t: Translate, locale: LocaleTag, code: string): string {
  const key = `common.languageName.${code}`;
  if (!Object.hasOwn(en, key)) return code;
  return languageNameInSentence(locale, t(key as MessageKey));
}
