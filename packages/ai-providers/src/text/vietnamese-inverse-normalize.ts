// The Vietnamese span rules, in priority order: date, year, clock, decimal,
// quantity. Longest-match, highest-priority-first, left to right; a token one
// rule consumed is unavailable to the next.
//
// Every rule obeys the same contract — consume a whole span and return one
// numeral, or return null and leave the words alone. None of them makes a
// partial commitment.
import {
  hasNumericNeighbour,
  rawAt,
  wordAt,
  groupThousands,
  runOf,
  type Context,
  type LanguageItn,
  type Match,
  type Rule,
} from './inverse-normalize.js';
import {
  CLOCK_MARKERS,
  DAY_MARKERS,
  DECIMAL_MARKER,
  HALF_MARKER,
  IDENTIFIER_MARKER,
  MONTH_MARKER,
  VIETNAMESE_TIERS,
  WRITTEN_SCALES,
  YEAR_MARKER,
  ZERO_FILLERS,
  parseCardinal,
  parseDigitString,
  parseSmallValue,
  parseYear,
} from './vietnamese-number-grammar.js';

const THOUSANDS = '.';

const pad = (value: number) => String(value).padStart(2, '0');

/** The words of the span, ready for a grammar. */
const slice = (context: Context, start: number, end: number) => context.lower.slice(start, end);

/**
 * One bounded part of a date — a day or a month — longest reading first.
 *
 * The shrink exists because `năm` is both the digit five and the marker that
 * introduces a year, so the run after `tháng` in
 * `tháng chín năm một chín bốn năm` greedily swallows the entire year and reads
 * 951945. Every over-long reading is out of range, and the first one in range is
 * the right one: `chín` = 9, leaving `năm một chín bốn năm` for the year rule.
 *
 * This still emits one numeral for one span — the shrink CHOOSES a shorter span
 * before parsing, it never publishes part of a longer parse.
 */
function component(
  context: Context,
  start: number,
  min: number,
  max: number,
): { value: number; end: number } | null {
  const runEnd = runOf(context, start);
  for (let end = runEnd; end > start; end -= 1) {
    const value = parseSmallValue(slice(context, start, end));
    if (value !== null && value >= min && value <= max) return { value, end };
  }
  return null;
}

/**
 * Dates: `ngày|mùng|mồng D [tháng M] [năm Y]` -> `ngày DD/MM[/YYYY]`.
 *
 * The marker word is KEPT. Dropping `ngày` was the shipped prompt's rule 6 and
 * the sole cause of both divergence-guard rejections it ever suffered; keeping
 * it dissolves the contradiction rather than picking a side, and it is what
 * makes "change no words" satisfiable at all.
 *
 * **A `tháng M` component or an unambiguous day marker is required.** A bare
 * `ngày <number>` is not enough evidence: `ngày mai` is "tomorrow", and the day
 * of a date is usually one of the five ambiguous numerals, so firing on `ngày`
 * alone would digitize ordinary speech.
 */
const date: Rule = (context, start) => {
  if (!DAY_MARKERS.has(wordAt(context, start))) return null;

  let cursor = start;
  const prefix: string[] = [rawAt(context, cursor)];
  cursor += 1;
  // `Ngày mùng hai ...` — both markers, spoken and both kept.
  if (cursor < context.limit && DAY_MARKERS.has(wordAt(context, cursor))) {
    prefix.push(rawAt(context, cursor));
    cursor += 1;
  }
  const explicitDay = prefix.some(
    (word) => DAY_MARKERS.has(word.toLowerCase()) && word.toLowerCase() !== 'ngày',
  );

  const day = component(context, cursor, 1, 31);
  if (!day) return null;
  cursor = day.end;

  let month: number | null = null;
  if (cursor < context.limit && wordAt(context, cursor) === MONTH_MARKER) {
    const parsed = component(context, cursor + 1, 1, 12);
    if (!parsed) return null;
    month = parsed.value;
    cursor = parsed.end;
  } else if (!explicitDay) {
    return null;
  }

  let year: number | null = null;
  if (cursor < context.limit && wordAt(context, cursor) === YEAR_MARKER) {
    const yearEnd = runOf(context, cursor + 1);
    if (yearEnd > cursor + 1) {
      year = parseYear(slice(context, cursor + 1, yearEnd));
      if (year !== null) cursor = yearEnd;
    }
  }

  const parts = [pad(day.value)];
  if (month !== null) parts.push(pad(month));
  if (year !== null) parts.push(String(year));
  return { end: cursor, text: `${prefix.join(' ')} ${parts.join('/')}` };
};

/**
 * A year after its marker: `sinh năm một chín mười ba` -> `sinh năm 1913`.
 *
 * Never digit-grouped — `năm 1.913` would be wrong Vietnamese, not merely
 * unconventional.
 */
const year: Rule = (context, start) => {
  if (wordAt(context, start) !== YEAR_MARKER) return null;
  const end = runOf(context, start + 1);
  if (end <= start + 1) return null;
  const value = parseYear(slice(context, start + 1, end));
  if (value === null) return null;
  return { end, text: `${rawAt(context, start)} ${value}` };
};

/**
 * Clocks: `H giờ [M [phút]]` -> `H:MM`, and `H giờ rưỡi` -> `H:30`.
 *
 * The hour is NOT zero-padded while a date's day and month are — an asymmetry
 * worth stating because it is easy to get wrong and a single slip fails recall
 * and hallucination simultaneously, the multiset metric counting one defect in
 * two places.
 */
const clock: Rule = (context, start) => {
  const hourEnd = runOf(context, start);
  if (hourEnd === start) return null;
  if (hourEnd >= context.limit || wordAt(context, hourEnd) !== 'giờ') return null;

  const hour = parseSmallValue(slice(context, start, hourEnd));
  if (hour === null || hour > 23) return null;

  let cursor = hourEnd + 1;
  let minute = 0;

  if (cursor < context.limit && wordAt(context, cursor) === HALF_MARKER) {
    minute = 30;
    cursor += 1;
  } else {
    const runEnd = runOf(context, cursor);
    // Longest first, then shrink. `mười một giờ ba mươi nghìn` must read 11:30
    // and leave `nghìn` behind rather than swallow it into an impossible
    // 30,000-minute value — but the shrink only ever CHOOSES a shorter span, it
    // never emits a fragment of a longer one.
    for (let candidate = runEnd; candidate > cursor; candidate -= 1) {
      // Inside a clock the ambiguity requirement is waived: `năm năm` is 55
      // here, because `giờ` has already established that a number is spoken.
      const value = parseMinute(slice(context, cursor, candidate));
      if (value === null) continue;
      minute = value;
      cursor = candidate;
      break;
    }
    if (cursor < context.limit && wordAt(context, cursor) === 'phút' && minute !== 0) cursor += 1;
  }

  return { end: cursor, text: `${hour}:${pad(minute)}` };
};

function parseMinute(words: string[]): number | null {
  const cardinal = parseCardinal(words);
  if (cardinal !== null && cardinal <= 59) return cardinal;
  const digits = parseDigitString(words, { requireUnambiguous: false });
  if (digits === null || digits.length > 2) return null;
  const value = Number(digits);
  return value <= 59 ? value : null;
}

/** Decimals: `không phẩy bốn` -> `0,4`. The comma is the decimal mark. */
const decimal: Rule = (context, start) => {
  const intEnd = runOf(context, start);
  if (intEnd === start) return null;
  if (intEnd >= context.limit || wordAt(context, intEnd) !== DECIMAL_MARKER) return null;

  const whole = parseCardinal(slice(context, start, intEnd), true);
  if (whole === null) return null;

  const fractionEnd = runOf(context, intEnd + 1);
  if (fractionEnd <= intEnd + 1) return null;
  const fraction = parseDigitString(slice(context, intEnd + 1, fractionEnd), {
    requireUnambiguous: false,
    minimumLength: 1,
  });
  if (fraction === null) return null;

  return {
    end: fractionEnd,
    text: `${groupThousands(String(whole), THOUSANDS)},${fraction}`,
  };
};

/**
 * A plain quantity, with the words that follow the mantissa left as words.
 *
 * `hai nghìn năm trăm tỷ đồng` -> `2.500 tỷ đồng`: everything up to `nghìn` is
 * absorbed into the numeral, `tỷ` stays, because that is how the written
 * language spells a large sum. `mười năm` -> `10 năm` for a different reason —
 * that `năm` is the noun, not the digit.
 */
const quantity: Rule = (context, start) => {
  const runEnd = runOf(context, start);
  if (runEnd === start) return null;

  // Peel the words that sit at the end of the run without being part of the
  // number, keeping each one exactly as spoken.
  let mantissaEnd = runEnd;

  // **A `năm` that CLOSES a run is the noun "year", not the digit five.**
  // Fifteen is `mười lăm` and twenty-five is `hai mươi lăm` — the units slot
  // above ten takes `lăm`, which is why `mười năm` is ten years and `bảy năm`
  // is seven. Reading those as 15 and 75 both invented a number and DELETED the
  // noun: `trong mười năm qua` came back as `trong 15 qua`, a sentence nobody
  // said. Peeled rather than refused, so the quantity in front of it is still
  // typeset and only the noun stays a word.
  //
  // Two shapes are left alone. A lone `năm` is not peelable at all — it is the
  // digit in `năm mét` and `năm người`, and there would be no mantissa left.
  // And a zero filler before it forces the digit reading, because `một trăm
  // linh năm` can only be 105.
  //
  // The marked rules are untouched: `giờ`, `phẩy` and the year marker have
  // already established that a number is being read, which is what keeps
  // `mười giờ bốn năm` -> `10:45` and `sinh năm một chín bốn năm` -> `năm 1945`.
  if (
    mantissaEnd - 1 > start &&
    wordAt(context, mantissaEnd - 1) === YEAR_MARKER &&
    !ZERO_FILLERS.has(wordAt(context, mantissaEnd - 2))
  ) {
    mantissaEnd -= 1;
  }

  while (mantissaEnd > start && WRITTEN_SCALES.has(wordAt(context, mantissaEnd - 1)))
    mantissaEnd -= 1;
  if (mantissaEnd === start) return null;
  const trailing = context.words.slice(mantissaEnd, runEnd);

  const words = slice(context, start, mantissaEnd);
  const single = words.length === 1;
  const head = words[0] ?? '';

  // A plain quantity may not BEGIN with a word that must never stand alone.
  // Only a stronger context can account for a leading zero — the decimal rule,
  // where it is absorbed into `0,4`. Without this, `số không không tám` comes
  // back as `số không 8`: half the readout typeset, half not. That a separated
  // digit readout stays as words is the cost this design accepted on purpose,
  // and it is recoverable by a reader in a way a reversed sentence is not.
  if (context.tiers.neverAlone.has(head)) return null;

  // A lone number word resting on nothing is not a quantity. Measured on
  // held-out speech, every one of these was a name or an idiom rather than a
  // count: `CHỊ HAI` (a form of address), `LE HAI` (a name), `KHIẾN HAI CHA
  // CON` (an idiom), `MỘT MÀU`, `MỘT GIẢI PHÁP`, `CHÚ TƯ`. So every single-token
  // span needs a neighbour saying a quantity is being spoken — and an AMBIGUOUS
  // one needs a true classifier, not merely a positional noun.
  //
  // This is what keeps `cổng số 3`, `tầng 7` and `2 tiếng` while `chú tư` stays
  // a name. It costs recall on a bare unattached numeral, deliberately: a
  // hallucination is a wrong sentence on a screen, recall is a number in a
  // table.
  const ambiguousHead = context.tiers.ambiguous.has(head);
  // A peeled word is itself the evidence, and the only evidence a lone mantissa
  // needs: a written scale or the year noun can only follow a number. It does
  // NOT vouch for an ambiguous numeral, which is what keeps `anh ba năm nay` —
  // "brother Ba, this year" — from becoming `anh 3 năm nay`.
  const vouchedByTrailing = trailing.length > 0 && !ambiguousHead;
  if (single && !vouchedByTrailing && !hasNumericNeighbour(context, start, runEnd, ambiguousHead)) {
    return null;
  }

  // `allowZero` is safe here and only here: a span may not BEGIN with `không`
  // (rejected above), and growth only crosses one mid-span when a scale word
  // follows — so the only `không` that can reach this is a genuine empty place
  // in a compound, as in 2026.
  const value = parseCardinal(words, true) ?? asDigitString(words, single);
  if (value === null) return null;

  const identifier = start > 0 && wordAt(context, start - 1) === IDENTIFIER_MARKER;
  // An identifier is not a quantity: `số 4.472` would be wrong, as would a
  // grouped year. Grouping applies to things you can count.
  const digits = identifier ? String(value) : groupThousands(String(value), THOUSANDS);
  return { end: runEnd, text: [digits, ...trailing].join(' ') };
};

function asDigitString(words: string[], single: boolean): number | null {
  if (single) return null;
  const digits = parseDigitString(words);
  return digits === null ? null : Number(digits);
}

export const VIETNAMESE_ITN: LanguageItn = {
  tiers: VIETNAMESE_TIERS,
  rules: [date, year, clock, decimal, quantity],
};

export { CLOCK_MARKERS };

/** Exported for the span-priority spec, which asserts the order is what ships. */
export const VIETNAMESE_RULE_ORDER: readonly string[] = [
  'date',
  'year',
  'clock',
  'decimal',
  'quantity',
];

export type { Match };
