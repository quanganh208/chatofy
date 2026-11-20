// Whether a polish edit put a name or a number into a line that nothing the
// speaker said supports.
//
// The polisher is asked to repair recognition errors, and it does so from world
// knowledge. On vi→en that is its value: "mode of adrec" comes back as "Dario
// Amodei of Anthropic", "VDI" as "VNeID". The same habit invents facts when the
// transcript is garbled past repair. Measured on a prod en→vi turn whose cut fell
// mid-word ("Have your hobbies changed since hoping?", said "since h- uh,
// childhood?"): the translator rendered it literally 10/10, and `gpt-5.6-sol`
// rewrote the draft into "kể từ khi có COVID" 5/5. Two prompt rewrites did not
// stop it (2/5 and 5/5), so the edit is checked instead.
//
// Only where it was measured safe. On the stored prod-polisher replay of 162
// recorded turns (`benchmarks/translation-judge`, arm 2, `gpt-5.6-sol`), this
// check rejects 0 of the 56 en→vi rewrites. Run on every direction, an offline
// version of it rejected 19 of the 78 vi→en and vi→zh rewrites, among them the
// best name repairs. An English transcript
// already spells every name the speaker said, so an en→vi edit has no name to
// recover that the source does not hold. A Vietnamese transcript does not.
//
// What it catches is the FORM of an invention, not the act: an invented event
// written in lower case ("kể từ khi đại dịch xảy ra") passes. And a name opening
// a sentence passes unless it carries a digit, because a capital there is
// ordinary casing. It also fails closed on some real edits — words turned into
// digits ("hai mươi lăm" → "25"), an exonym swap ("Hoa Kỳ" → "Mỹ") — which keep
// the draft. The `rejected=name` rate in the prod log is what to widen it on.
import type { LanguageCode } from '../interfaces/provider-types.js';

/** `source→target` pairs the check runs on. Add a pair only after measuring it. */
const CHECKED_DIRECTIONS = new Set(['en→vi']);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
/** A sentence ends at terminal punctuation (closing quotes or brackets may follow it), or at a line break. */
const SENTENCE_END = /(?<=[.!?…]["”’»)\]]*)\s+|\n+/u;
/** An opening quote or bracket right before a word starts a quoted sentence. */
const OPENS_QUOTE = /["“«(\[]\s*$/u;
const PIECE_SEPARATOR = /['’-]/u;

const fold = (word: string): string => word.toLocaleLowerCase('und');

/**
 * Words that read as a name or a number: a digit anywhere, or a capital on a
 * word that does not open a sentence or a quotation.
 */
function namedWords(text: string): string[] {
  const named: string[] = [];
  for (const sentence of text.trim().split(SENTENCE_END)) {
    let first = true;
    for (const match of sentence.matchAll(WORD)) {
      const word = match[0];
      const opens = first || OPENS_QUOTE.test(sentence.slice(0, match.index));
      first = false;
      if (/\p{N}/u.test(word) || (!opens && /\p{Lu}/u.test(word))) named.push(word);
    }
  }
  return named;
}

function vocabulary(texts: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of text.match(WORD) ?? []) {
      words.add(fold(word));
      for (const piece of word.split(PIECE_SEPARATOR)) if (piece) words.add(fold(piece));
    }
  }
  return words;
}

/** A word is supported whole, or when every piece of it is (`covid 19` supports `COVID-19`). */
function supported(word: string, known: Set<string>): boolean {
  if (known.has(fold(word))) return true;
  const pieces = word.split(PIECE_SEPARATOR).filter(Boolean);
  return pieces.length > 1 && pieces.every((piece) => known.has(fold(piece)));
}

export interface PolishNameCheck {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  source: string;
  draft: string;
  context?: readonly string[];
  edited: string;
}

/**
 * True when the edit adds a name or number found in none of the transcript, the
 * draft and the earlier speech, on a direction where that cannot be a repair.
 */
export function addsUnsupportedName(check: PolishNameCheck): boolean {
  if (!CHECKED_DIRECTIONS.has(`${check.sourceLanguage}→${check.targetLanguage}`)) return false;
  // Composed form before tokenising: a decomposed Vietnamese mark is not a
  // letter, so it would split "Việt" into pieces no other text contains.
  const nfc = (text: string): string => text.normalize('NFC');
  const known = vocabulary([check.source, check.draft, ...(check.context ?? [])].map(nfc));
  return namedWords(nfc(check.edited)).some((word) => !supported(word, known));
}
