// Reading a language pair a client SAVED before pairs existed.
//
// Settings used to store the pair as one `${source}_to_${target}` string. Web
// localStorage and extension storage still hold that string for anyone who has
// not changed a setting since, and dropping it would silently reset their
// languages. This is the one place that still knows the old spelling, and it is
// read only by the two settings readers — never by a wire schema.
import { type LanguagePair, languagePairSchema } from './languages.js';

const STORED_SEPARATOR = '_to_';

/**
 * The pair an old stored setting named, or null when it names none — not a
 * string, not two registry languages, or the same language twice.
 */
export function languagePairFromStoredDirection(value: unknown): LanguagePair | null {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(STORED_SEPARATOR);
  if (at < 0) return null;
  const parsed = languagePairSchema.safeParse({
    source: value.slice(0, at),
    target: value.slice(at + STORED_SEPARATOR.length),
  });
  return parsed.success ? parsed.data : null;
}
