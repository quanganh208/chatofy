// Spoken letter-and-number codes -> their written form: `trại giam a hai` ->
// `trại giam A2`, `tầng hầm bê hai` -> `tầng hầm B2`, `quốc lộ một a` ->
// `quốc lộ 1A`.
//
// The recognizer writes a spelled letter one of two ways, and both were seen on
// real audio: as a bare Latin letter (`đua mô tô f một` for F1) or as the
// letter's Vietnamese name (`súng trường mờ mười sáu` for M16, `bê hai` for B2,
// `a hai` for A2). Without this rule the number beside it is a lone number word
// with no classifier, so it stays a word, and the restorer reads the pair as a
// name: `trại giam A Hai`.
//
// The two spellings get different evidence requirements, because only one of
// them can be an ordinary word:
//
// - A lone consonant is never Vietnamese — every syllable has a vowel — so
//   `f một` is a code wherever it occurs.
// - Every letter NAME is also a word. `anh ấy bê hai thùng nước` is "carries
//   two crates", `con bê hai tháng tuổi` a two-month-old calf, `mắt tôi mờ hai
//   hôm nay` blurred eyes, `bị u hai bên` a tumour on both sides, `ca ba` the
//   third shift. So a name becomes a letter only straight after a noun that
//   introduces a code ({@link CODE_MARKERS}), or straight after another code
//   that did (`đốt sống lờ bốn lờ năm` -> `L4 L5`).
//
// Same contract as every other rule: the whole span becomes one code or nothing
// changes. The `không` guard still applies to the result, so `phòng a không có
// ai` keeps its negation instead of becoming `A0` — which costs `F0`, a code
// that cannot be told apart from that sentence by its words.
import { wordAt, type Context, type Rule } from './inverse-normalize.js';
import {
  BOUND_DIGITS,
  YEAR_MARKER,
  parseCardinal,
  parseDigitString,
} from './vietnamese-number-grammar.js';

/**
 * One consonant alone: never a Vietnamese syllable, so always a spelled letter.
 *
 * One, not a run. Runs of consonants are units and abbreviations far more often
 * than spelled codes: the recognizer writes `kg` (`nặng một trăm năm mươi kg`),
 * and written text is full of `đc`, `bs`, `ml` — `mổ đc hai tháng` became
 * `mổ ĐC2 tháng` when runs were allowed. `vtv ba` stays words as the cost.
 */
const CONSONANT_LETTER = /^[bcdđfghjklmnpqrstvwxz]$/u;

/**
 * Vietnamese names of the Latin letters, both the alphabet names (`bê`, `xê`,
 * `đê`) and the phonics names taught for reading (`bờ`, `cờ`, `mờ`, `lờ`), since
 * speakers use both: `mờ mười sáu` is how FLEURS reads M16. Every one of them is
 * also an ordinary word or close to one, which is why none of them is read as a
 * letter without a marker.
 */
const LETTER_NAMES = new Map<string, string>([
  ['a', 'A'],
  ['bê', 'B'],
  ['bờ', 'B'],
  ['xê', 'C'],
  ['xi', 'C'],
  ['cờ', 'C'],
  ['đê', 'D'],
  ['dê', 'D'],
  ['dờ', 'D'],
  ['e', 'E'],
  ['ép', 'F'],
  ['giê', 'G'],
  ['gờ', 'G'],
  ['hát', 'H'],
  ['hắt', 'H'],
  ['i', 'I'],
  ['ca', 'K'],
  ['ka', 'K'],
  ['lờ', 'L'],
  ['mờ', 'M'],
  ['en', 'N'],
  ['nờ', 'N'],
  ['o', 'O'],
  ['pê', 'P'],
  ['pờ', 'P'],
  ['quy', 'Q'],
  ['rờ', 'R'],
  ['ét', 'S'],
  ['sờ', 'S'],
  ['tê', 'T'],
  ['tờ', 'T'],
  ['u', 'U'],
  ['vê', 'V'],
  ['vờ', 'V'],
  ['ích', 'X'],
  ['y', 'Y'],
  ['dét', 'Z'],
]);

/**
 * The letter names that may FOLLOW a number (`quốc lộ một a` -> 1A, `siêu âm
 * bốn đê` -> 4D). Narrower than the names: written codes of this shape end in A
 * to D, and B and C are left out because their names are verbs that follow a
 * place and a number all the time — `lên tầng hai bê đồ xuống` ("carry"),
 * `tầng hai xê dịch` ("shift"). A bare `b` or `c` still reads.
 */
const TRAILING_LETTER_NAMES = new Set(['a', 'đê']);

/**
 * Nouns that introduce a code, matched as the words straight before it.
 *
 * Taken from where codes actually sit: the words before 6,420 letter-digit
 * codes in the vicappunc corpus (`vitamin B12`, `đốt sống L4`, `kháng nguyên
 * P24`, `khẩu trang N95`, `siêu âm 4D`), the two production turns that needed
 * one (`trại giam A2`, `tầng hầm B2`), and the FLEURS line with `súng trường
 * M16`. A noun that is mostly followed by a name or a count of its own — `nhà`,
 * `anh`, `đường` — is left out: a missing code stays readable words, a wrong one
 * is a sentence nobody said.
 */
const CODE_MARKERS: readonly (readonly string[])[] = [
  'trại',
  'trại giam',
  'tầng',
  'hầm',
  'phòng',
  'khu',
  'lô',
  'dãy',
  'tòa',
  'tòa nhà',
  'cổng',
  'cửa',
  'sảnh',
  'quầy',
  'toa',
  'khoang',
  'quốc lộ',
  'tỉnh lộ',
  'vitamin',
  'đốt sống',
  'đĩa đệm',
  'kháng nguyên',
  'hạng',
  'bằng lái',
  'trình độ',
  'chứng chỉ',
  'tiếng anh',
  'giải',
  'đội tuyển',
  'kênh',
  'súng',
  'súng trường',
  'tên lửa',
  'xe tăng',
  'máy bay',
  'mẫu',
  'mã',
  'ký hiệu',
  'khẩu trang',
  'hội nghị',
  'nhóm',
  'siêu âm',
  'lớp',
  'giai đoạn',
].map((phrase) => phrase.split(' '));

/** Scales a code never contains: nobody spells `B2000` as `bê hai nghìn`. */
const LARGE_SCALES = new Set(['nghìn', 'ngàn', 'triệu', 'tỷ', 'tỉ']);

/**
 * Nouns that count, beyond the classifiers and units in the tiers: `hai bên` is
 * "both sides", and `năm` after a number is the year.
 */
const COUNTED_AFTER = new Set(['bên', YEAR_MARKER]);

/** How far back a chain of codes is followed: `B1 B6 B12` is three. */
const MAX_CHAIN = 4;

interface Letter {
  /** The letter or letters as written. */
  text: string;
  /** Spelled with consonants alone, so it needs no marker. */
  bare: boolean;
}

/** The spelled letter at `index`, if the word there is one. */
function letterAt(context: Context, index: number): Letter | null {
  if (index < 0) return null;
  const word = wordAt(context, index);
  if (CONSONANT_LETTER.test(word)) return { text: word.toUpperCase(), bare: true };
  const name = LETTER_NAMES.get(word);
  return name === undefined ? null : { text: name, bare: false };
}

/**
 * Are the words `from` to `to` separated by whitespace alone?
 *
 * Evidence for a code never crosses punctuation, for the reason no span does:
 * the restorer ends a sentence with a marker as easily as with anything else,
 * and `anh ấy ở tầng. Mờ hai hôm nay.` is blurred eyes, not M2.
 */
function joined(context: Context, from: number, to: number): boolean {
  for (let at = from + 1; at <= to; at += 1) {
    if (!/^\s*$/u.test(context.gaps[at] ?? '')) return false;
  }
  return true;
}

/** Does a code marker end straight before `index`, with nothing but spaces between? */
function markedAt(context: Context, index: number): boolean {
  return CODE_MARKERS.some((phrase) => {
    const first = index - phrase.length;
    return (
      first >= 0 &&
      phrase.every((word, at) => wordAt(context, first + at) === word) &&
      joined(context, first, index)
    );
  });
}

/** Is the word at `index` a number word, wherever the span limit is? */
function isNumberAt(context: Context, index: number): boolean {
  return context.tiers.inside.has(wordAt(context, index));
}

/**
 * May the letter at `index` be read as one?
 *
 * A marker straight before it, or a code straight before it that could itself
 * be read — `đốt sống lờ bốn lờ năm`, where the second `lờ` follows `lờ bốn`.
 */
function letterVouched(context: Context, index: number, depth = 0): boolean {
  if (markedAt(context, index)) return true;
  if (depth >= MAX_CHAIN) return false;
  let previous = index - 1;
  while (previous >= 0 && isNumberAt(context, previous)) previous -= 1;
  if (previous === index - 1) return false;
  const letter = letterAt(context, previous);
  if (letter === null || !joined(context, previous, index)) return false;
  return letter.bare || letterVouched(context, previous, depth + 1);
}

/**
 * The end of the number words from `start`, inside the span limit, without the
 * negations that close it.
 *
 * `không` inside a readout is a zero (`a một không hai` -> A102), but at the end
 * of one it is the negation of what follows: `phòng a hai không có ai` is A2 and
 * "nobody there", and reading the run whole printed `phòng A20 có ai`. The
 * `neverAlone` guard cannot see that, because the zero it would refuse is glued
 * to other digits.
 */
function numberRunEnd(context: Context, start: number): number {
  let end = start;
  while (end < context.limit && isNumberAt(context, end)) end += 1;
  while (end > start && context.tiers.neverAlone.has(wordAt(context, end - 1))) end -= 1;
  return end;
}

/**
 * The number part of a code, read whole, or null.
 *
 * A cardinal (`mười sáu` -> 16, `hai mươi ba` -> 23) or a digit readout (`một
 * không hai` -> 102). Three digits at most, and nothing a count would begin
 * with only after another number (`tư`, `mốt`, `lăm`).
 */
function codeNumber(words: string[]): string | null {
  const head = words[0];
  if (head === undefined || BOUND_DIGITS.has(head)) return null;
  if (words.some((word) => LARGE_SCALES.has(word))) return null;
  // A `năm` that closes a longer run is the year noun at least as often as the
  // digit: `trại giam a hai mươi năm` is twenty years, not A25.
  if (words.length > 1 && words[words.length - 1] === YEAR_MARKER) return null;
  const cardinal = parseCardinal(words, true);
  // Inside a readout it has the same second reading: `a hai năm năm` is A2 and
  // five years at least as often as A25.
  if (cardinal === null && words.length > 1 && words.includes(YEAR_MARKER)) return null;
  const digits =
    cardinal === null
      ? parseDigitString(words, { requireUnambiguous: false, minimumLength: 1 })
      : String(cardinal);
  return digits !== null && digits.length <= 3 ? digits : null;
}

/**
 * Does the number that ends at `end` read as a count rather than a code?
 *
 * A classifier or unit after it says it is counting something: `viêm gan b hai
 * tháng`, `bị u hai bên`, `b hai năm nay`. And a lone AMBIGUOUS number (`một`,
 * `ba`, `tư`, `năm`, `không`) is a code only where nothing follows it but
 * another code or the end of the phrase, because with a word after it it is the
 * article or the year: `vitamin bê một số bệnh`, `viêm gan c năm ngoái`. That
 * keeps `trình độ bê một` and `lờ bốn lờ năm`, and costs `f một rất hấp dẫn`.
 */
function readsAsCount(context: Context, start: number, end: number): boolean {
  const next = wordAt(context, end);
  if (context.tiers.outside.has(next) || COUNTED_AFTER.has(next)) return true;
  const lone = end - start === 1 && context.tiers.ambiguous.has(wordAt(context, start));
  if (!lone || end >= context.limit) return false;
  // Another code straight after it, letter AND number: `bê một bê sáu`.
  return letterAt(context, end) === null || !isNumberAt(context, end + 1);
}

/** A letter, then a number: `a hai` -> `A2`, `mờ mười sáu` -> `M16`. */
export const letterThenNumber: Rule = (context, start) => {
  const letter = letterAt(context, start);
  if (letter === null || start + 1 >= context.limit) return null;
  // Part of a longer spelling (`vê tê vê ba`) that cannot be read whole here.
  // Typesetting only its last letter would print `vê tê V3`.
  if (letterAt(context, start - 1) !== null) return null;
  if (!letter.bare && !letterVouched(context, start)) return null;

  // Glued to a numeral before it, the letter is a unit: `15h`, `4d`, `hba1c`.
  if (/\d$/u.test(context.gaps[start] ?? '')) return null;

  const end = numberRunEnd(context, start + 1);
  if (end === start + 1 || readsAsCount(context, start + 1, end)) return null;
  const digits = codeNumber(context.lower.slice(start + 1, end));
  if (digits === null) return null;
  return { end, text: `${letter.text}${digits}` };
};

/** A number, then a letter, after a marker: `quốc lộ một a` -> `quốc lộ 1A`. */
export const numberThenLetter: Rule = (context, start) => {
  if (!isNumberAt(context, start) || !markedAt(context, start)) return null;
  const runEnd = numberRunEnd(context, start);
  if (runEnd >= context.limit) return null;

  const word = wordAt(context, runEnd);
  const letter = letterAt(context, runEnd);
  if (letter === null || (!letter.bare && !TRAILING_LETTER_NAMES.has(word))) return null;
  // `lớp mười hai a một` is a class code this does not read; leave all of it.
  if (isNumberAt(context, runEnd + 1)) return null;

  const digits = codeNumber(context.lower.slice(start, runEnd));
  if (digits === null) return null;
  return { end: runEnd + 1, text: `${digits}${letter.text}` };
};
