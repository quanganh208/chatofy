// The word lists the divergence guard reasons over, kept apart from the
// alignment and scoring that consume them.
//
// Split from `repair-divergence.ts` because they are two different kinds of
// thing that change for two different reasons: the scorer changes when the
// ALGORITHM is wrong, and these change when a language turns out to say
// something the lists had not heard yet. Every entry below is data about
// Vietnamese or English; nothing here knows what a residual is.
import type { LanguageCode } from '../interfaces/provider-types.js';

/**
 * The words a spoken number is made of, in four tiers by how much each one can
 * be trusted, and where.
 *
 * The tiers are not tidiness, they are the guard's soundness. Several counting
 * words are also ordinary words — `không` is "zero" and also the everyday
 * negation, `năm` is "five" and also "year", `ba` is "three" and also "dad" —
 * and a single flat list lets the worst failure this feature has straight
 * through: `không phải` ("not") rewritten as `0 phải` is one token, matched by
 * one list entry, with a digit on the other side. That is the README's own
 * motivating hallucination, and it scored a perfect 0.0000 until these were
 * separated.
 *
 * `counting` words justify an exemption. `filler` words may only travel inside a
 * span some counting word already justified. `neighbour` words justify nothing
 * and may travel nowhere — they are read only OUTSIDE a span, as evidence that
 * the span sits in a numeric context. `neverAlone` words are refused a shape no
 * genuine numeral takes, whatever justified the span around them.
 */
export interface NumberVocabulary {
  /** Unambiguous enough that its presence identifies a span as a number. */
  counting: Set<string>;
  /** Plausible inside a number, but far too common to vouch for one. */
  filler: Set<string>;
  /**
   * Words that count as numeric CONTEXT when they sit beside a span, and are
   * never read inside one.
   *
   * These are the classifiers and units a number is spoken with rather than part
   * of: `ba người`, `năm tuổi`, `một cái`, `bốn lần`. Vietnamese requires a
   * classifier after a number for countable nouns, so this is the ordinary
   * shape of a spoken quantity rather than an edge case — and without these
   * words the guard refused it. Measured on the shipped scorer before this tier
   * existed:
   *
   *     REJECT residual=0.2000  "có ba người ở đây" -> "Có 3 người ở đây."
   *     REJECT residual=0.2500  "nó năm tuổi rồi"   -> "Nó 5 tuổi rồi."
   *     REJECT residual=0.3333  "một cái bánh"      -> "1 cái bánh."
   *
   * The rejection is WHOLE-TURN — {@link MAX_REPAIR_DIVERGENCE} is zero, so one
   * such phrase anywhere in an utterance discards the repair for the entire
   * line and the reader gets the raw lowercase text back with nothing saying
   * why. `hai người` was accepted the whole time, because `hai` is a counting
   * word and vouches from inside; only the five ambiguous numerals
   * (`không`, `một`, `ba`, `tư`, `năm`) needed the neighbour, and those are
   * among the commonest numbers in speech.
   *
   * **A separate tier rather than more `filler`, and the separation is the
   * safety.** A `filler` word may travel INSIDE a span, so adding `người` there
   * would let `ba người` → `3 ngày` through: both sides entirely number
   * vocabulary, a digit present, a word nobody said on screen. Read only as an
   * outside neighbour, these words can add evidence that a span is numeric and
   * can never be part of what a span is permitted to become.
   */
  neighbour: Set<string>;
  /**
   * Words that must never come back as a bare numeral of their own, mapped to
   * the numeral each one must not become.
   *
   * `không` is the whole reason this exists: it is the word for zero and also the
   * ordinary Vietnamese negation, so digitizing it does not merely alter a
   * sentence, it reverses one — on screen, in the speaker's own words, with
   * nothing marking it.
   *
   * **Three separate holes were measured before this rule was right**, and each
   * defeated the previous attempt:
   *
   *  - `tôi không đồng ý` → `Tôi 0 đồng ý.` — the span is `không` alone, and the
   *    ordinary neighbour-vouch accepted it because `đồng` sits beside it.
   *  - `hai mươi không đủ` → `20 0 đủ.` — `không` swept INTO a span that already
   *    held the counting word `mươi`, riding on someone else's justification.
   *  - `nó không trăm phần trăm đúng` → `Nó 0 100 phần trăm đúng.` — "not 100%
   *    correct". Blocking the neighbour path and demanding number vocabulary
   *    AFTER the word both fail here, because the thing being negated is itself
   *    a number. Lexically it is indistinguishable from a zero heading a numeral.
   *
   * All three scored exactly 0.0000. What actually separates them is not context
   * at all but SHAPE: a spoken zero is **absorbed into** the numeral it belongs
   * to — `không phẩy bốn` → `0,4`, `không tám tám ba` → `0883` — and never comes
   * back standing on its own. A digitized negation always does, because there is
   * no number for it to join.
   *
   * So the test is one line and needs no neighbours: does a bare `0` appear on
   * the repaired side of a span that contained `không`? That subsumes all three
   * holes above, which is why the two earlier rules were deleted rather than
   * kept alongside it. It is also why widening {@link neighbour} cannot reopen
   * them — this check runs first and consults nothing outside the span.
   *
   * The cost, stated because it is real: a separated digit readout
   * (`số không không tám` → `Số 0 0 8`) and a literal `không độ` → `0 độ` are
   * now refused and show raw. Both are rare; a reversed sentence is not
   * recoverable by the reader, and a missing comma is.
   */
  neverAlone: Map<string, string>;
}

/**
 * Vietnamese.
 *
 * Includes the positional variants a reader of a word list would forget:
 * `lăm`/`mốt` replace five/one above twenty (`hai mươi lăm`), `linh`/`lẻ` fill
 * an empty tens place, and `mùng`/`mồng` precede a day of the month. Units are
 * here too — `giờ`, `phút`, `mét` — because a repair routinely absorbs them into
 * the numeral it writes (`không phẩy bốn mét` → `0,4 m`).
 */
const VI: NumberVocabulary = {
  counting: new Set([
    'mốt',
    'hai',
    'bốn',
    'lăm',
    'sáu',
    'bảy',
    'tám',
    'chín',
    'mười',
    'mươi',
    'trăm',
    'nghìn',
    'ngàn',
    'triệu',
    'tỷ',
    'tỉ',
    'linh',
    'lẻ',
    'rưỡi',
    'chục',
    'phẩy',
    'giờ',
    'phút',
    'giây',
    'mùng',
    'mồng',
    'mét',
  ]),
  filler: new Set([
    // Every one of these is a common content word in its own right.
    'không',
    'một',
    'ba',
    'tư',
    'năm',
    'ngày',
    'tháng',
    'phần',
    'trên',
    'độ',
    'đồng',
    'vuông',
    'ki',
    'lô',
    'gam',
    'số',
    // Unit ABBREVIATIONS, which only ever appear on the repaired side: the
    // recognizer spells `mét` out and the repair may write `m`. Without them a
    // legitimate `không phẩy bốn mét` → `0,4 m` is scored as a paraphrase, and
    // `0,4 m` is the exact rendering this plan's reproduction passage asks for.
    'm',
    'km',
    'cm',
    'mm',
    'kg',
    'g',
    'h',
    'c',
  ]),
  // Classifiers and units, which follow a number rather than belonging to it.
  // Vouch-only: see {@link NumberVocabulary.neighbour} for why these are not
  // simply more `filler`, and for the measured rejections that produced them.
  neighbour: new Set([
    'người',
    'tuổi',
    'lần',
    'cái',
    'con',
    'chiếc',
    'tuần',
    'tấn',
    'lít',
    'đô',
    'la',
    'ly',
    'chai',
    'tờ',
    'trang',
    'tầng',
    'phòng',
    'điểm',
    'chỗ',
    'suất',
  ]),
  neverAlone: new Map([['không', '0']]),
};

/**
 * English, which `en_to_vi` repairs need.
 *
 * The direction is not a Vietnamese feature and the implementation must not
 * assume it is: on `en_to_vi` the transcript being repaired is English, and a
 * guard that only knew Vietnamese counting words would score every English
 * number rewrite as a paraphrase and reject every repair on that half of the
 * product.
 *
 * `one`, `a`, `and`, `may`, `march`, `second` and `point` are filler for the
 * same reason `không` is: each is a far more common ordinary word than it is
 * part of a number.
 */
const EN: NumberVocabulary = {
  counting: new Set([
    'zero',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
    'hundred',
    'thousand',
    'million',
    'billion',
    'first',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
    'twelfth',
    'twentieth',
    'thirtieth',
    'percent',
    'degrees',
    'metres',
    'meters',
    'kilometres',
    'kilometers',
    'kilograms',
    "o'clock",
    'oclock',
    'january',
    'february',
    'april',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ]),
  filler: new Set([
    'oh',
    'one',
    'a',
    'and',
    'point',
    'half',
    'quarter',
    'second',
    'may',
    'march',
    'am',
    'pm',
    'p',
    'm',
    'metre',
    'meter',
    'grams',
  ]),
  // English has the same gap for the same reason: `one` is filler, so `one
  // person` → `1 person` reached no counting word and was refused outright.
  // English does not need a classifier the way Vietnamese does, so this list is
  // units and the few nouns a bare quantity is most often spoken with.
  neighbour: new Set([
    'people',
    'person',
    'years',
    'year',
    'months',
    'weeks',
    'days',
    'hours',
    'minutes',
    'seconds',
    'times',
    'dollars',
    'pounds',
    'euros',
    'cents',
    'miles',
    'feet',
    'inches',
    'copies',
    'items',
    'pieces',
  ]),
  // English has no negation that doubles as a digit, so nothing here reverses a
  // meaning — but the same SHAPE misfires on words that are far commoner as
  // ordinary words than as numbers. Measured: `i want a second opinion` → `I
  // want 1 second opinion.`, `in may a storm hit` → `In 5 a storm hit.`, `we
  // march a mile` → `We 3 a mile.`, all at 0.0000. `one` is deliberately absent:
  // it means the number far more often than not, and `at one o'clock` → `1:00`
  // is absorbed into a numeral and unaffected either way.
  neverAlone: new Map([
    ['a', '1'],
    ['second', '2'],
    ['march', '3'],
    ['may', '5'],
  ]),
};

/** Vocabulary per transcript language. `vi` is the fallback for an unknown one. */
export const VOCABULARY: Record<LanguageCode, NumberVocabulary> = { vi: VI, en: EN };
