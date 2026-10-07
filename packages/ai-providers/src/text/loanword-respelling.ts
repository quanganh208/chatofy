import type { LanguageCode } from '../interfaces/provider-types.js';
import { foreignSpans, type ForeignSpan } from './vietnamese-syllable.js';

/**
 * The deterministic half of loanword respelling: what a model's proposal must
 * satisfy before it may replace words on the reader's line.
 *
 * The Vietnamese recognizer has no English vocabulary, so "deepfake" reaches
 * the transcript as "deep fred". The translator usually sees through it — the
 * English line says "deepfakes" — but the Vietnamese line kept the garble, and
 * the restorer even capitalised it into a name. A model is asked how each
 * foreign span should be spelled; this file decides whether to believe it.
 *
 * The model is not trusted, for the reason §3.14 of the development journey
 * took the model off this path: an injected answer on the display is a fluent
 * line in the right language, sitting where the speaker's words go. So a
 * proposal is accepted only if it is:
 *
 * - Latin script. Respelling a foreign word never needs a Vietnamese mark, and
 *   this is what turns down "đét-lai" for "deadline".
 * - Different letters, not only different case or spacing. "Amode" → "A mode"
 *   changes nothing a reader could use.
 * - Attested in the translation of the same words. The proposal has to be
 *   something the translator independently wrote, so a prompt cannot make the
 *   line say a word the translation does not.
 * - Close in letters to what was heard. A respelling repairs hearing; a
 *   proposal far from the heard letters is a substitution.
 *
 * `sourceText` never changes. Only the display does, and the client already
 * offers the recognizer's words under it whenever the two differ.
 */

/**
 * Accepted spellings, keyed by the span as heard, lowercased.
 *
 * Keyed by text rather than by position so the same map serves every line the
 * same words reach — the turn's own restore, and a block of turns typeset as
 * one — and lowercased because the restore cases the very words the key was
 * taken from. Later turns are not respelled from it; they get the spellings as
 * recognizer hotwords instead.
 */
export type Respellings = Readonly<Record<string, string>>;

/** The key a span is filed under in {@link Respellings}. */
export function respellingKey(spanText: string): string {
  return spanText.normalize('NFC').toLowerCase();
}

/**
 * Lowest letter similarity at which a proposal still counts as a respelling.
 *
 * Measured on the 50 Vietnamese turns in production on 2026-10-07: the lowest
 * right proposal there was "ammon" → "Altman" at 0.55, then "defec" →
 * "deepfake" at 0.62. It is a floor against substitution — a proposal sharing
 * little with what was heard — not a precision knob: wrong proposals in that
 * set scored as high as right ones, and were stopped by the other guards.
 */
export const MIN_RESPELLING_SIMILARITY = 0.5;

/** Longest accepted spelling; the same ceiling as one hotword term. */
export const MAX_RESPELLING_LENGTH = 64;

/** Letters, digits, and the separators a written name uses — and nothing else. */
const LATIN_SPELLING = /^[A-Za-z0-9][A-Za-z0-9 ,'-]*$/;

/**
 * A letter only Vietnamese writes: đ, a breve, a circumflex, a horn, or a tone
 * mark, in decomposed form. The recognizer spells a foreign word it does not
 * know in plain letters, so a span carrying one is Vietnamese the syllable
 * test could not parse — a highland place name like "Đắk Lắk" or "Krông" — and
 * not garbled English.
 */
const VIETNAMESE_MARK = /[\u0111\u0110\u0300\u0301\u0303\u0306\u0309\u031b\u0323\u0302]/u;

/** `text`'s letters with every mark removed, for "only the marks changed". */
function foldedLettersOf(text: string): string {
  return lettersOf(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\u0111/g, 'd'),
  );
}

/** `record[key]` when it is the record's own string, never an inherited member. */
function ownString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** A run of letters and digits: one word. */
const WORD = /[\p{L}\p{N}]+/gu;

/** How many translation words one proposal may be matched against. */
const MAX_ATTESTED_WORDS = 3;

/** The letters of a string, lowercased, for comparison only. */
function lettersOf(text: string): string {
  return (text.normalize('NFC').toLowerCase().match(WORD) ?? []).join('');
}

/** Length of the longest common subsequence of two strings. */
function commonSubsequence(a: string, b: string): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const charA of a) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        charA === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * How alike two strings' letters are, from 0 to 1.
 *
 * Twice the common subsequence over the combined length: the measure of how
 * much of what was heard survives in the proposal, in order. Edit distance was
 * the other candidate and scores "defec" → "deepfake" far lower, because the
 * recognizer drops whole syllables rather than swapping letters.
 */
export function letterSimilarity(a: string, b: string): number {
  const x = lettersOf(a);
  const y = lettersOf(b);
  if (x.length + y.length === 0) return 1;
  return (2 * commonSubsequence(x, y)) / (x.length + y.length);
}

/**
 * Every run of one to {@link MAX_ATTESTED_WORDS} words in the translations, as
 * letters — plus the same run without a plural "s", since the translation
 * inflects ("deepfakes") where the speaker's word stands bare.
 */
function attestedForms(translations: Partial<Record<LanguageCode, string>>): Set<string> {
  const forms = new Set<string>();
  for (const text of Object.values(translations)) {
    const words = text?.normalize('NFC').match(WORD) ?? [];
    for (let length = 1; length <= MAX_ATTESTED_WORDS; length++) {
      for (let start = 0; start + length <= words.length; start++) {
        const form = lettersOf(words.slice(start, start + length).join(' '));
        forms.add(form);
        if (form.length > 1 && form.endsWith('s')) forms.add(form.slice(0, -1));
      }
    }
  }
  return forms;
}

/**
 * The spans a translation does not already spell exactly as heard.
 *
 * "openai" and "interpol" are foreign but right — the translation writes the
 * same letters — and asking a model about them would spend a call to be told
 * so. Only what is left is worth a respelling.
 */
export function unresolvedSpans(
  spans: readonly ForeignSpan[],
  translations: Partial<Record<LanguageCode, string>>,
): ForeignSpan[] {
  const attested = attestedForms(translations);
  return spans.filter(
    (span) =>
      !VIETNAMESE_MARK.test(span.text.normalize('NFD')) && !attested.has(lettersOf(span.text)),
  );
}

/**
 * The proposals that pass every guard.
 *
 * `proposals` is keyed by span text, as the model was asked; a key that names
 * no span sent is ignored, and so is a null answer, which is the model saying
 * the span is already right.
 */
export function acceptRespellings(
  spans: readonly ForeignSpan[],
  proposals: Readonly<Record<string, string | null | undefined>>,
  translations: Partial<Record<LanguageCode, string>>,
): Record<string, string> {
  const attested = attestedForms(translations);
  const accepted: Record<string, string> = {};
  for (const span of spans) {
    const proposal = ownString(proposals, span.text)?.trim();
    if (!proposal || proposal.length > MAX_RESPELLING_LENGTH) continue;
    if (!LATIN_SPELLING.test(proposal)) continue;
    const letters = lettersOf(proposal);
    if (letters === lettersOf(span.text)) continue;
    // A respelling that only drops the marks writes Vietnamese without its
    // diacritics — "Dak Lak" for "Đắk Lắk" — which is not a repair of hearing.
    if (letters === foldedLettersOf(span.text)) continue;
    if (!attested.has(letters)) continue;
    if (letterSimilarity(span.text, proposal) < MIN_RESPELLING_SIMILARITY) continue;
    accepted[respellingKey(span.text)] = proposal;
  }
  return accepted;
}

/** Whether position `index` of `text` begins a sentence. */
function startsSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before.length === 0 || /[.!?…]$/u.test(before);
}

/**
 * `line` with each foreign span that has an accepted spelling replaced by it.
 *
 * The spans are found again on `line` itself, which is the transcript or its
 * restore — the restore is checked to keep the recognizer's words, so it holds
 * the same spans, only cased. Each is replaced in place, by position, so the
 * punctuation the restorer put around it stays where it was, and a spelling
 * that lands at the start of a sentence gets a capital, as any word there would.
 */
export function applyRespellings(line: string, spellings: Respellings): string {
  if (Object.keys(spellings).length === 0) return line;
  const words = [...line.normalize('NFC').matchAll(WORD)];
  const text = line.normalize('NFC');
  let result = '';
  let cursor = 0;
  for (const span of foreignSpans(text)) {
    const spelling = ownString(spellings, respellingKey(span.text));
    const first = words[span.firstWord];
    const last = words[span.firstWord + span.wordCount - 1];
    if (spelling === undefined || !first || !last) continue;
    const start = first.index;
    const end = last.index + last[0].length;
    // A name already cased inside ("iPhone") keeps its own casing.
    const written =
      startsSentence(text, start) && !/\p{Lu}/u.test(spelling.slice(1))
        ? spelling.charAt(0).toUpperCase() + spelling.slice(1)
        : spelling;
    result += text.slice(cursor, start) + written;
    cursor = end;
  }
  return result + text.slice(cursor);
}
