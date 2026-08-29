// The English ITN. The display path is bidirectional and always was — on
// `en_to_vi` the transcript being typeset is the ENGLISH one — so deleting the
// LLM repair without this would have silently stopped display on half the
// product while the schema kept documenting it.
//
// **This is deliberately narrower than the Vietnamese side, and the asymmetry is
// evidence, not neglect.** There is no English display-fidelity reference
// corpus: `manifest-vi-display.jsonl` is the only one, and the 50 held-out
// moonshine utterances contain zero digits, so they can score hallucination but
// not recall. English therefore has no in-sample spoken recall figure at all.
// The right response to weaker evidence is a smaller claim, so English recognizes
// fewer shapes and abstains sooner.
//
// English grammars do not transfer from Vietnamese and are not copied: `o'clock`
// and `half past` instead of `giờ`, month names instead of `tháng`, `point`
// instead of `phẩy` — and the separators invert, because English writes `0.4`
// and `2,500` where Vietnamese writes `0,4` and `2.500`. Emitting the Vietnamese
// convention into an English line would be a defect, not a house style.
import { VOCABULARY } from './repair-number-vocabulary.js';
import {
  groupThousands,
  hasNumericNeighbour,
  rawAt,
  wordAt,
  runOf,
  type Context,
  type LanguageItn,
  type NumberTiers,
  type Rule,
} from './inverse-normalize.js';

const DECIMAL = '.';
const THOUSANDS = ',';

const UNITS = new Map<string, number>([
  ['zero', 0],
  ['oh', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
]);

const TENS = new Map<string, number>([
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
]);

const SCALES = new Map<string, number>([
  ['hundred', 100],
  ['thousand', 1000],
  ['million', 1_000_000],
  ['billion', 1_000_000_000],
]);

/** Day-of-month words. `second` is absent on purpose — see {@link MONTHS}. */
const ORDINALS = new Map<string, number>([
  ['first', 1],
  ['third', 3],
  ['fourth', 4],
  ['fifth', 5],
  ['sixth', 6],
  ['seventh', 7],
  ['eighth', 8],
  ['ninth', 9],
  ['tenth', 10],
  ['eleventh', 11],
  ['twelfth', 12],
  ['thirteenth', 13],
  ['fourteenth', 14],
  ['fifteenth', 15],
  ['sixteenth', 16],
  ['seventeenth', 17],
  ['eighteenth', 18],
  ['nineteenth', 19],
  ['twentieth', 20],
  ['thirtieth', 30],
]);

/**
 * Months usable as a date anchor.
 *
 * **`march` and `may` are excluded**, and that is the same judgement that put
 * them in `neverAlone`: both are far commoner as a verb and a modal than as a
 * month, and anchoring a date on one would read `they march third in line` as a
 * date in March. `august` is a marginal adjective and kept, since the adjective
 * is rare and capitalized in practice.
 */
const MONTHS = new Map<string, number>([
  ['january', 1],
  ['february', 2],
  ['april', 4],
  ['june', 6],
  ['july', 7],
  ['august', 8],
  ['september', 9],
  ['october', 10],
  ['november', 11],
  ['december', 12],
]);

const CLOCK_MARKERS = new Set(["o'clock", '’clock', 'oclock']);
const MERIDIEM = new Set(['am', 'pm']);
const DECIMAL_MARKER = 'point';

function englishTiers(): NumberTiers {
  const en = VOCABULARY.en;

  // Only the words that are genuinely numbers. `a`, `second`, `march` and `may`
  // are never consumed at all: English has an unambiguous word for each of those
  // values (`one`, `two`, `three`, `five`), so refusing the ambiguous form costs
  // almost no recall and removes the entire class of failure the guard measured
  // (`i want a second opinion` -> `I want 1 second opinion.`).
  const inside = new Set<string>([...UNITS.keys(), ...TENS.keys(), ...SCALES.keys()]);

  const outside = new Set<string>(en.neighbour);
  for (const word of en.counting) {
    if (!inside.has(word) && !MONTHS.has(word)) outside.add(word);
  }
  for (const word of en.filler) {
    if (!inside.has(word)) outside.add(word);
  }
  for (const marker of CLOCK_MARKERS) outside.add(marker);

  return {
    inside,
    outside,
    // English has no birth-order naming convention, so its positional nouns do
    // not carry the `phòng Ba Le` reading and the two evidence tiers coincide.
    strong: outside,
    anchors: new Set([...MONTHS.keys(), ...CLOCK_MARKERS, ...MERIDIEM]),
    // `one` and `oh` are consumable but may not carry a span alone.
    ambiguous: new Set(['one', 'oh']),
    // English never consumes its `neverAlone` words at all, so nothing can sit
    // interior to a numeral on their account.
    interiorAfter: new Set(),
    leftMarkers: new Set(['number', 'no']),
    neverAlone: en.neverAlone,
  };
}

export const ENGLISH_TIERS = englishTiers();

const slice = (context: Context, start: number, end: number) => context.lower.slice(start, end);
const pad = (value: number) => String(value).padStart(2, '0');

/** A compound cardinal, or null if the words do not make exactly one. */
export function parseCardinal(words: string[]): number | null {
  let total = 0;
  let section = 0;
  let pending: number | null = null;
  let digitCount = 0;

  for (const word of words) {
    if (word === 'and') {
      if (pending !== null) return null;
      continue;
    }

    const tens = TENS.get(word);
    if (tens !== undefined) {
      if (pending !== null) return null;
      pending = tens;
      digitCount += 1;
      continue;
    }

    const unit = UNITS.get(word);
    if (unit !== undefined) {
      if (pending !== null) {
        // `twenty five` = 25. Anything else is two numbers, not one.
        if (pending % 10 !== 0 || pending < 20 || pending > 90 || unit >= 10) return null;
        pending += unit;
      } else {
        pending = unit;
      }
      digitCount += 1;
      continue;
    }

    const scale = SCALES.get(word);
    if (scale === undefined) return null;

    if (scale >= 1000) {
      const head = section + (pending ?? 0);
      if (head === 0) return null;
      total += head * scale;
      section = 0;
      pending = null;
    } else {
      section += (pending ?? 1) * scale;
      pending = null;
    }
  }

  if (digitCount === 0) return null;
  return total + section + (pending ?? 0);
}

function parseDigitString(words: string[]): string | null {
  if (words.length < 2) return null;
  const digits: number[] = [];
  for (const word of words) {
    const digit = UNITS.get(word);
    if (digit === undefined || digit > 9) return null;
    digits.push(digit);
  }
  return digits.join('');
}

function groupValue(words: string[]): number | null {
  const cardinal = parseCardinal(words);
  if (cardinal !== null && cardinal <= 99) return cardinal;
  const digits = parseDigitString(words);
  return digits !== null && digits.length <= 2 ? Number(digits) : null;
}

/** `nineteen thirteen` -> 1913, which no single-cardinal reading reaches. */
export function parseYear(words: string[]): number | null {
  const cardinal = parseCardinal(words);
  if (cardinal !== null && cardinal >= 1000 && cardinal <= 2999) return cardinal;
  for (let split = 1; split < words.length; split += 1) {
    const lead = groupValue(words.slice(0, split));
    const tail = groupValue(words.slice(split));
    if (lead === null || tail === null) continue;
    if (lead < 10 || lead > 29 || tail > 99) continue;
    return lead * 100 + tail;
  }
  return null;
}

function dayValue(context: Context, start: number): { value: number; end: number } | null {
  const ordinal = ORDINALS.get(wordAt(context, start));
  if (ordinal !== undefined) return { value: ordinal, end: start + 1 };
  const end = runOf(context, start);
  if (end === start) return null;
  const value = parseCardinal(slice(context, start, end));
  return value === null || value < 1 || value > 31 ? null : { value, end };
}

/**
 * `october tenth nineteen thirteen` -> `october 10 1913`.
 *
 * **Not a slashed `DD/MM/YYYY`, and that is the point of building this
 * separately rather than porting the Vietnamese rule.** English names its months
 * in words, so emitting the month as a digit beside the word it came from gives
 * `october 10/10/1913` — the month said twice. `October 10, 1913` is how the
 * language writes the date, and it also keeps every spoken word, which
 * `DD/MM` cannot.
 *
 * The day is not zero-padded here for the same reason: English writes
 * `October 5`, not `October 05`. The Vietnamese convention does not transfer.
 */
const date: Rule = (context, start) => {
  if (!MONTHS.has(wordAt(context, start))) return null;
  const day = dayValue(context, start + 1);
  if (!day || day.end > context.limit) return null;

  let cursor = day.end;
  const parts = [String(day.value)];
  const yearEnd = runOf(context, cursor);
  if (yearEnd > cursor) {
    const value = parseYear(slice(context, cursor, yearEnd));
    if (value !== null) {
      parts.push(String(value));
      cursor = yearEnd;
    }
  }

  return { end: cursor, text: `${rawAt(context, start)} ${parts.join(' ')}` };
};

/** `half past two` -> `2:30`, `quarter to nine` -> `8:45`. */
const spokenOffset: Rule = (context, start) => {
  const word = wordAt(context, start);
  if (word !== 'half' && word !== 'quarter') return null;
  const relation = wordAt(context, start + 1);
  if (relation !== 'past' && relation !== 'to') return null;

  const end = runOf(context, start + 2);
  if (end <= start + 2 || end > context.limit) return null;
  const hour = parseCardinal(slice(context, start + 2, end));
  if (hour === null || hour > 23) return null;

  const minutes = word === 'half' ? 30 : 15;
  if (relation === 'past') return { end, text: `${hour}:${pad(minutes)}` };
  const previous = hour === 0 ? 23 : hour - 1;
  return { end, text: `${previous}:${pad(60 - minutes)}` };
};

/** `six o'clock` -> `6:00`; `six thirty pm` -> `6:30 pm`. */
const clock: Rule = (context, start) => {
  const hourEnd = runOf(context, start);
  if (hourEnd === start) return null;

  if (hourEnd < context.limit && CLOCK_MARKERS.has(wordAt(context, hourEnd))) {
    const hour = parseCardinal(slice(context, start, hourEnd));
    if (hour === null || hour > 23) return null;
    return { end: hourEnd + 1, text: `${hour}:00` };
  }

  // `six thirty pm` — a bare two-part time needs the meridiem to say it is one.
  // Without it, `six thirty` is as likely to be two quantities.
  if (hourEnd >= context.limit || !MERIDIEM.has(wordAt(context, hourEnd))) return null;
  for (let split = start + 1; split < hourEnd; split += 1) {
    const hour = parseCardinal(slice(context, start, split));
    const minute = parseCardinal(slice(context, split, hourEnd));
    if (hour === null || minute === null || hour > 23 || minute > 59) continue;
    return { end: hourEnd, text: `${hour}:${pad(minute)}` };
  }
  return null;
};

/** `zero point four` -> `0.4`. */
const decimal: Rule = (context, start) => {
  const intEnd = runOf(context, start);
  if (intEnd === start) return null;
  if (intEnd >= context.limit || wordAt(context, intEnd) !== DECIMAL_MARKER) return null;

  const whole = parseCardinal(slice(context, start, intEnd));
  if (whole === null) return null;

  const fractionEnd = runOf(context, intEnd + 1);
  if (fractionEnd <= intEnd + 1) return null;
  const digits: number[] = [];
  for (const word of slice(context, intEnd + 1, fractionEnd)) {
    const digit = UNITS.get(word);
    if (digit === undefined || digit > 9) return null;
    digits.push(digit);
  }

  return {
    end: fractionEnd,
    text: `${groupThousands(String(whole), THOUSANDS)}${DECIMAL}${digits.join('')}`,
  };
};

const quantity: Rule = (context, start) => {
  const end = runOf(context, start);
  if (end === start) return null;
  const words = slice(context, start, end);

  // Same rule as Vietnamese: a lone number word with no numeric context around
  // it is far likelier to be an ordinary word than a count.
  if (words.length === 1 && !hasNumericNeighbour(context, start, end)) return null;

  const value = parseCardinal(words);
  if (value !== null) return { end, text: groupThousands(String(value), THOUSANDS) };

  // English says a year as two groups and gives it no marker word: `nineteen
  // ninety eight` has no single-cardinal reading, and unlike Vietnamese there is
  // no `năm` in front to announce it. A year is never digit-grouped.
  const year = parseYear(words);
  return year === null ? null : { end, text: String(year) };
};

export const ENGLISH_ITN: LanguageItn = {
  tiers: ENGLISH_TIERS,
  rules: [date, spokenOffset, clock, decimal, quantity],
};
