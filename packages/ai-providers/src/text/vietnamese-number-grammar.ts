// What Vietnamese number words are worth, and the three ways a run of them can
// be read. Kept apart from the span rules for the same reason
// `repair-number-vocabulary.ts` is kept apart from the scorer that consumes it:
// these change when the language turns out to say something the tables had not
// heard, the rules change when a reading is wrong.
import { VOCABULARY } from './repair-number-vocabulary.js';
import type { NumberTiers } from './inverse-normalize.js';

/** Digit words, including the positional variants a word list would forget. */
const DIGITS = new Map<string, number>([
  ['không', 0],
  ['một', 1],
  ['mốt', 1], // replaces `một` above twenty: `hai mươi mốt`
  ['hai', 2],
  ['ba', 3],
  ['tư', 4],
  ['bốn', 4],
  ['năm', 5],
  ['lăm', 5], // replaces `năm` above twenty: `hai mươi lăm`
  ['sáu', 6],
  ['bảy', 7],
  ['tám', 8],
  ['chín', 9],
]);

/**
 * Scale words, and whether one may stand without a digit before it.
 *
 * `mười` is the number ten and leads on its own (`mười lăm` = 15). `mươi` is a
 * multiplier and cannot (`hai mươi` = 20, and a bare `mươi` is not a number).
 * Conflating them turns `mươi` alone into 10.
 */
const SCALES = new Map<string, { value: number; leads: boolean }>([
  ['mười', { value: 10, leads: true }],
  ['mươi', { value: 10, leads: false }],
  ['chục', { value: 10, leads: true }],
  ['trăm', { value: 100, leads: true }],
  ['nghìn', { value: 1000, leads: true }],
  ['ngàn', { value: 1000, leads: true }],
  ['triệu', { value: 1_000_000, leads: true }],
  ['tỷ', { value: 1_000_000_000, leads: true }],
  ['tỉ', { value: 1_000_000_000, leads: true }],
]);

/**
 * Fills an empty tens place: `một trăm linh năm` = 105.
 *
 * Exported because it is also the one shape that forces the DIGIT reading of a
 * trailing `năm`, which the quantity rule otherwise peels off as the noun
 * "year". See the peel in `vietnamese-inverse-normalize.ts`.
 */
export const ZERO_FILLERS = new Set(['linh', 'lẻ']);

/**
 * Scale words that are WRITTEN rather than spelled out in digits.
 *
 * Vietnamese writes `2.500 tỷ đồng`, not the thirteen digits that number
 * actually has, and `120.000 đồng` rather than `120 nghìn`. So everything up to
 * `nghìn` is absorbed into the numeral and everything above it stays a word
 * beside the mantissa. This is the plan's "scaled quantity" rule and it is a
 * convention of the written language, not a rounding decision.
 */
export const WRITTEN_SCALES = new Set(['triệu', 'tỷ', 'tỉ']);

export const DECIMAL_MARKER = 'phẩy';
export const CLOCK_MARKERS = new Set(['giờ', 'phút', 'giây']);
/** `hai giờ rưỡi` — half past, and the only fractional clock form in use. */
export const HALF_MARKER = 'rưỡi';
export const DAY_MARKERS = new Set(['ngày', 'mùng', 'mồng']);
export const MONTH_MARKER = 'tháng';
export const YEAR_MARKER = 'năm';
/** Introduces an identifier, which is never digit-grouped: `số 4472`. */
export const IDENTIFIER_MARKER = 'số';

/**
 * The five counting words that are commoner as ordinary words than as numbers.
 *
 * `không` is zero and the everyday negation, `năm` is five and "year", `ba` is
 * three and "dad", `tư` is four and a personal name, `một` is one and the
 * indefinite article. A span resting on nothing but these is not evidence of a
 * number.
 */
const AMBIGUOUS = new Set(['không', 'một', 'ba', 'tư', 'năm']);

/**
 * Nouns of place and position, which vouch for a number far more weakly than a
 * classifier does.
 *
 * What follows `phòng`, `tầng`, `trang`, `chỗ` or `điểm` is as often a NAME as a
 * number — Vietnamese names rooms and people after birth order, so `phòng Ba Le`
 * and `chị Hai` are ordinary. A classifier (`ba người`, `một chiếc`) carries no
 * such reading: it can only follow a count.
 */
const POSITIONAL_NOUNS = new Set(['phòng', 'tầng', 'trang', 'chỗ', 'điểm']);

/**
 * The ITN's own tiers, derived from the guard's vocabulary rather than copied
 * from it. See {@link NumberTiers} for the measured reason those are different
 * predicates and why reusing the guard's tiers caps recall at 30/42.
 *
 * The data file itself is not edited — this is a reading of it.
 */
function vietnameseTiers(): NumberTiers {
  const vi = VOCABULARY.vi;

  // `counting`, minus the markers and units that sit BESIDE a numeral rather
  // than in it, plus the ambiguous digits the guard had to file as `filler`.
  const inside = new Set<string>();
  for (const word of vi.counting) {
    if (CLOCK_MARKERS.has(word) || DAY_MARKERS.has(word)) continue;
    if (word === DECIMAL_MARKER || word === HALF_MARKER || word === 'mét') continue;
    inside.add(word);
  }
  for (const word of AMBIGUOUS) inside.add(word);

  // `neighbour` (already vouch-only) plus the non-numeral nouns and units the
  // guard filed as `filler`, which provide adjacency evidence and are never
  // consumed.
  const outside = new Set<string>(vi.neighbour);
  for (const word of vi.filler) {
    if (!inside.has(word)) outside.add(word);
  }
  for (const word of CLOCK_MARKERS) outside.add(word);
  outside.add('mét');
  outside.add(HALF_MARKER);
  // A duration unit the guard never needed, because the repair absorbed it into
  // the numeral rather than reading across it: `hai tiếng ba mươi phút`.
  outside.add('tiếng');

  // Only a true classifier or measure word may vouch for an ambiguous numeral
  // standing alone. See {@link NumberTiers.strong}.
  const strong = new Set<string>(outside);
  for (const word of POSITIONAL_NOUNS) strong.delete(word);

  return {
    inside,
    outside,
    strong,
    // Anchor a span even when every numeral in it is ambiguous, which is the
    // whole of why `ngày năm tháng một` is reachable.
    anchors: new Set([...DAY_MARKERS, MONTH_MARKER, YEAR_MARKER]),
    ambiguous: AMBIGUOUS,
    interiorAfter: new Set(SCALES.keys()),
    leftMarkers: new Set([IDENTIFIER_MARKER]),
    neverAlone: vi.neverAlone,
  };
}

export const VIETNAMESE_TIERS = vietnameseTiers();

/**
 * A compound cardinal, or null if the words do not make exactly one.
 *
 * Returns null rather than a best effort, which is the whole discipline: the
 * previous prototype's `2.000 500` came from emitting what it had understood so
 * far when the rest would not attach.
 */
export function parseCardinal(words: string[], allowZero = false): number | null {
  let total = 0;
  let section = 0;
  let pending: number | null = null;
  let digitCount = 0;

  for (const word of words) {
    if (ZERO_FILLERS.has(word)) {
      if (pending !== null) return null;
      continue;
    }

    const digit = DIGITS.get(word);
    if (digit !== undefined) {
      // Two bare digits in a row are a digit STRING (`bốn năm` = 45), not a
      // cardinal. Letting the second overwrite the first silently read
      // `mười giờ bốn năm` as five.
      if (pending !== null) return null;
      // `không` may only ever begin a numeral it is absorbed into — the decimal
      // `0,4`, or a digit string. As a cardinal's digit it would let
      // `hai mươi không` come back as 20 with a word deleted.
      if (digit === 0 && !allowZero) return null;
      pending = digit;
      digitCount += 1;
      continue;
    }

    const scale = SCALES.get(word);
    if (!scale) return null;

    if (scale.value >= 1000) {
      const head = section + (pending ?? 0);
      // A scale word with no mantissa is not a number: a stranded `nghìn` must
      // not come back as 0.
      if (head === 0) return null;
      total += head * scale.value;
      section = 0;
      pending = null;
      continue;
    }

    if (pending === null && !scale.leads) return null;
    // `mười` is the number ten and does NOT take a multiplier — `hai mười` is
    // not Vietnamese, `hai mươi` is. So a digit sitting before it belongs to a
    // previous number, and this span holds two numbers rather than one.
    // Measured: `mười một mười hai mười ba` ("eleven twelve thirteen") otherwise
    // reads as a single 43, a number nobody said. Refusing here abstains on the
    // whole run instead, which is the trade this design makes everywhere.
    if (pending !== null && scale.leads && scale.value === 10) return null;
    // `mười` and `chục` ARE the number ten and stand on their own, so they count
    // as content. `trăm`, `nghìn` and above are multipliers: a bare `trăm` is not
    // "a hundred" the way a bare `mười` is "ten", and treating it as one would
    // let a stranded scale word come back as a digit.
    if (pending === null && scale.value === 10) digitCount += 1;
    section += (pending ?? 1) * scale.value;
    pending = null;
  }

  if (digitCount === 0) return null;
  return total + section + (pending ?? 0);
}

/**
 * A read-out digit string: `hai năm tư` -> `254`, `bốn năm` -> `45`.
 *
 * `requireUnambiguous` is what keeps `anh ba năm nay` — "brother Ba, this year"
 * — from becoming `anh 35 nay`. A bare span made only of the five ambiguous
 * counting words is refused; a span inside a clock or after a decimal marker
 * waives it, because the marker has already established that a number is being
 * spoken.
 */
export function parseDigitString(
  words: string[],
  { requireUnambiguous = true, minimumLength = 2 } = {},
): string | null {
  if (words.length < minimumLength) return null;
  const digits: number[] = [];
  for (const word of words) {
    const digit = DIGITS.get(word);
    if (digit === undefined) return null;
    digits.push(digit);
  }
  if (requireUnambiguous && words.every((word) => AMBIGUOUS.has(word))) return null;
  return digits.join('');
}

/**
 * A year spoken as two two-digit groups: `một chín mười ba` -> 1913.
 *
 * This reading has to exist separately because the digit-string grammar rejects
 * `mười`, so `19|13` is unreachable without it — and `một chín bốn năm` -> 1945
 * is the corpus's own date.
 */
export function parseYearPair(words: string[]): number | null {
  for (let split = 1; split < words.length; split += 1) {
    const lead = groupValue(words.slice(0, split));
    const tail = groupValue(words.slice(split));
    if (lead === null || tail === null) continue;
    if (lead < 10 || lead > 29 || tail > 99) continue;
    return lead * 100 + tail;
  }
  return null;
}

/** A 0-99 group, read either as a cardinal or as two digits. */
function groupValue(words: string[]): number | null {
  const cardinal = parseCardinal(words);
  if (cardinal !== null && cardinal <= 99) return cardinal;
  const digits = parseDigitString(words, { requireUnambiguous: false });
  if (digits === null) return null;
  const value = Number(digits);
  return digits.length <= 2 ? value : null;
}

/**
 * A year in any of its spoken forms.
 *
 * `hai nghìn không trăm hai mươi sáu` is an ordinary cardinal; `một chín bốn
 * năm` is a digit pair. Both are years and neither is ever digit-grouped.
 */
export function parseYear(words: string[]): number | null {
  const pair = parseYearPair(words);
  if (pair !== null) return pair;
  const cardinal = parseCardinal(words, true);
  if (cardinal !== null && cardinal >= 1000 && cardinal <= 2999) return cardinal;
  return null;
}

/** A small counting value — a day, a month, an hour, a minute. */
export function parseSmallValue(words: string[]): number | null {
  const cardinal = parseCardinal(words);
  if (cardinal !== null) return cardinal;
  const digits = parseDigitString(words, { requireUnambiguous: false });
  return digits === null ? null : Number(digits);
}
