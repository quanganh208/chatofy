// What a run of Chinese number characters is worth, or `null` when the run is
// not a well-formed number. Kept apart from the span rules in
// `chinese-inverse-normalize.ts` for the reason the Vietnamese grammar is: the
// tables change when the language says something they had not heard, the rules
// change when a reading is wrong.

/** Digit characters as Paraformer writes them; `幺` is 1 read in phone numbers. */
const DIGITS = new Map<string, number>([
  ['零', 0],
  ['〇', 0],
  ['一', 1],
  ['幺', 1],
  ['二', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
]);

const SMALL_UNITS = new Map<string, number>([
  ['十', 10],
  ['百', 100],
  ['千', 1000],
]);

const ZEROS = new Set(['零', '〇']);

/** Every character a spoken number is written with. */
export const NUMBER_CHARACTER = /[零〇一幺二两三四五六七八九十百千万亿]/u;

/** Only digit characters, read one at a time: `二零一三`, `幺三八`. */
export const DIGIT_RUN = /^[零〇一幺二三四五六七八九]+$/u;

/** `二零一三` → `2013`. Undefined for anything that is not a digit run. */
export function digitRunValue(run: string): string | undefined {
  if (!DIGIT_RUN.test(run)) return undefined;
  return [...run].map((character) => DIGITS.get(character)).join('');
}

/**
 * A section below ten thousand: `三千零五` = 3005, `十五` = 15.
 *
 * Strict on purpose. Units must fall (`十十` is nothing), two digits may not
 * touch (`三四` is "three or four", not a number), and a trailing digit after
 * `百`/`千` with no `零` before it is the colloquial abbreviation `一百五` = 150,
 * which is refused rather than guessed. `十` may stand without a digit only at
 * the head of the whole number (`十五`) or after a `零` (`一千零十`).
 */
function sectionValue(section: string, leads: boolean): number | null {
  let total = 0;
  let digit: number | null = null;
  let digitIsLiang = false;
  let lastUnit = Number.POSITIVE_INFINITY;
  let afterZero = false;
  for (const character of section) {
    if (ZEROS.has(character)) {
      if (digit !== null || total === 0 || afterZero) return null;
      afterZero = true;
      continue;
    }
    const unit = SMALL_UNITS.get(character);
    if (unit !== undefined) {
      if (unit >= lastUnit) return null;
      let multiplier = digit;
      if (multiplier === null) {
        if (unit !== 10 || !((leads && total === 0) || afterZero)) return null;
        multiplier = 1;
      }
      if (digitIsLiang && unit === 10) return null;
      total += multiplier * unit;
      lastUnit = unit;
      digit = null;
      digitIsLiang = false;
      afterZero = false;
      continue;
    }
    if (digit !== null) return null;
    digitIsLiang = character === '两';
    digit = digitIsLiang ? 2 : (DIGITS.get(character) ?? null);
    if (digit === null || digit === 0) return null;
  }
  if (digit !== null) {
    // A bare ones digit: after `十`, after `零`, or the whole section.
    if (digitIsLiang && total > 0) return null;
    if (total > 0 && lastUnit !== 10 && !afterZero) return null;
    total += digit;
  } else if (afterZero) {
    return null;
  }
  return total > 0 ? total : null;
}

/** Below 10^8: `[section 万] [零] [section]`. */
function belowYi(text: string, leads: boolean): number | null {
  const at = text.indexOf('万');
  if (at < 0) return sectionValue(text, leads);
  if (text.indexOf('万', at + 1) >= 0) return null;
  const high = sectionValue(text.slice(0, at), leads);
  if (high === null) return null;
  const rest = text.slice(at + 1).replace(/^[零〇]/u, '');
  if (!rest) return high * 10_000;
  const low = sectionValue(rest, false);
  return low === null ? null : high * 10_000 + low;
}

/**
 * The value of a cardinal written in Chinese characters, or `null`.
 *
 * `十` 10, `一百零五` 105, `两千` 2000, `三万五千` 35000, `一亿` 10^8; `十十` and
 * `三四` are null. Digit runs (`二零一三`) are NOT cardinals and read null here;
 * they go through {@link digitRunValue}.
 */
export function chineseCardinal(text: string): number | null {
  if (!text || /^[零〇]/u.test(text)) return null;
  const at = text.indexOf('亿');
  if (at < 0) return belowYi(text, true);
  if (text.indexOf('亿', at + 1) >= 0) return null;
  const high = belowYi(text.slice(0, at), true);
  if (high === null || high >= 10_000) return null;
  const rest = text.slice(at + 1).replace(/^[零〇]/u, '');
  if (!rest) return high * 100_000_000;
  const low = belowYi(rest, false);
  return low === null ? null : high * 100_000_000 + low;
}
