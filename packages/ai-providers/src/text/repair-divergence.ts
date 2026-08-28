// How far a repaired transcript has drifted from the words that were actually
// recognized — with the drift that repairing NUMBERS necessarily causes
// discounted, because otherwise it drowns out the drift that matters.
//
// The failure this exists to catch is a paraphrase: a mis-recognized `ngọt`
// coming back as a confident `ngập` the speaker never said. On screen that is a
// fluent, plausible sentence, and nobody reading it can tell. The repair prompt
// forbids it; this is what enforces the prohibition when the prompt is not
// obeyed, which is the only version of that rule worth having.
//
// A flat edit-distance threshold cannot do the job, and the arithmetic says so
// rather than intuition: inverse text normalization is inherently high-distance.
// `mười bảy giờ` → `17:00` collapses three tokens into one, so a ten-token turn
// carrying one clock time has already moved ~30% with nothing wrong. The
// reproduction passage carries three such spans. A flat 25% guard would reject
// the feature on its own demonstration.
//
// So the distance is computed over ALIGNED SPANS, and a span is forgiven only
// when it is unmistakably a number being rewritten as a number: BOTH sides are
// entirely number vocabulary, some raw word is unambiguously a counting word,
// and the repaired side carries a digit. What remains measures content-word
// substitution and nothing else.
//
// Every clause of that is load-bearing and each was added after a measured
// false-accept. Without "both sides", `mười bảy giờ` → `17:00 chiều` smuggles in
// an afternoon nobody said. Without the counting-word requirement, `không phải`
// ("not") → `0 phải` — the README's own motivating hallucination — scores a
// perfect zero, because `không` IS the word for zero. And the digit requirement
// is what makes these word lists safe to be as permissive as they are: `năm` is
// both "five" and "year", `ba` both "three" and "dad", and `ba` → `Ba Đình`
// reaches no digit and is scored in full.
import { normalizeTranscript } from './vietnamese.js';
import type { LanguageCode } from '../interfaces/provider-types.js';

/**
 * The words a spoken number is made of, split by whether one can VOUCH for a
 * span on its own.
 *
 * The split is not tidiness, it is the guard's soundness. Several counting words
 * are also ordinary words — `không` is "zero" and also the everyday negation,
 * `năm` is "five" and also "year", `ba` is "three" and also "dad" — and a single
 * flat list lets the worst failure this feature has straight through: `không
 * phải` ("not") rewritten as `0 phải` is one token, matched by one list entry,
 * with a digit on the other side. That is the README's own motivating
 * hallucination, and it scored a perfect 0.0000 until these were separated.
 *
 * So `counting` words can justify an exemption; `filler` words may only travel
 * inside a span that some counting word already justified. `không phẩy bốn` is
 * vouched for by `phẩy` and `bốn`; `không` alone vouches for nothing.
 */
interface NumberVocabulary {
  /** Unambiguous enough that its presence identifies a span as a number. */
  counting: Set<string>;
  /** Plausible inside a number, but far too common to vouch for one. */
  filler: Set<string>;
  /**
   * Words whose non-numeric sense is so much commoner that no amount of
   * surrounding number vocabulary may digitize them. Only what FOLLOWS them can.
   *
   * `không` is the whole reason this exists: it is the word for zero and also
   * the ordinary Vietnamese negation, so digitizing it does not merely alter a
   * sentence, it reverses one — on screen, in the speaker's own words, with
   * nothing marking it.
   *
   * Two separate holes were measured here, and the second is why the rule is
   * about the FOLLOWING token rather than about neighbours generally:
   *
   *  - `tôi không đồng ý` → `Tôi 0 đồng ý.` — the span is `không` alone, and the
   *    ordinary neighbour-vouch accepted it because `đồng` sits beside it.
   *  - `hai mươi không đủ` → `20 0 đủ.` — `không` is swept INTO a span that
   *    already contains the counting word `mươi`, so it rode along on someone
   *    else's justification. Likewise `lúc mười giờ không phải mười một giờ`.
   *
   * Both scored exactly 0.0000. The rule that separates them from the real cases
   * is what comes NEXT: a spoken zero is only ever the head of a longer number —
   * `không phẩy bốn` (0,4), `không tám tám ba` (a digit string read aloud) — so
   * the token after it is more number. A negation is followed by whatever is
   * being negated: `đủ`, `phải`, `đúng`, nothing at all.
   */
  neverAlone: Set<string>;
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
  neverAlone: new Set(['không']),
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
  // English has no equivalent of `không`: `zero`, `oh` and `one` do not double
  // as the negation. Empty rather than absent, so the shape stays uniform and
  // the next language added has to answer the question.
  neverAlone: new Set<string>(),
};

const VOCABULARY: Record<LanguageCode, NumberVocabulary> = { vi: VI, en: EN };

/**
 * One word, or one written number, and nothing else.
 *
 * The numeral alternative leads and is greedy from the first digit, so `0,4`
 * and `2/9/1945` each stay ONE token — the whole point, since a numeral split
 * into pieces at its own separators would look like several insertions. That
 * also means the comma inside `0,4` is part of the number rather than a clause
 * boundary, which is the Vietnamese decimal convention.
 *
 * Punctuation matches nothing and is therefore dropped, along with casing below.
 * That is deliberate and it is this guard's stated blind spot: it compares WORDS,
 * so it cannot detect a repair that mangles punctuation or capitalization. That
 * is correct for a paraphrase guard — those are the things the repair is
 * supposed to change — and it is why it is written here rather than left to be
 * discovered.
 */
// `\p{L}\p{M}` and never `\w` or `[^\W\d_]`. In JavaScript `\w` stays ASCII
// even under the `u` flag, so the obvious spelling excludes every accented
// Vietnamese letter and splits `tôi` into `t` and `i` — which silently folds
// `má` and `mà` to the same token and blinds this guard to the one error class
// it exists to catch. Measured, not feared: that spelling was here first and
// scored a `má` → `mà` substitution as a perfect match.
const TOKEN = /\d+(?:[.,:/]\d+)*|[\p{L}\p{M}]+/gu;

/**
 * Comparison tokens for one side.
 *
 * `normalizeTranscript` + `toLowerCase`, and **never `foldForMatch`**. That
 * helper strips combining marks — it says so in its own header, and says it must
 * never be sent anywhere — which folds `má` and `mà` into one string. Using it
 * here would blind this guard to precisely the tone-substitution case it exists
 * to catch: the one Vietnamese error class where the wrong word is one mark away
 * from the right one. An implementer reaching for the existing helper is the
 * expected mistake, so it is named.
 */
function tokenize(text: string): string[] {
  return normalizeTranscript(text).toLowerCase().match(TOKEN) ?? [];
}

const hasDigit = (token: string): boolean => /\d/.test(token);

/** One maximal run of aligned edits, with the tokens on each side of it. */
interface EditSpan {
  raw: string[];
  repaired: string[];
  /** Edit operations the alignment spent here — substitutions plus the length gap. */
  cost: number;
  /**
   * Index in the raw token list where this span's raw side begins.
   *
   * Carried so the span can be judged in context. A lone `ba` becoming `3` is
   * meaningless on its own and obvious next to `số` or `giờ` — see
   * {@link isNumeralRewrite}.
   */
  rawStart: number;
}

/**
 * Maximal runs of non-matching tokens, from a token-level edit alignment.
 *
 * Runs rather than single operations, because the thing being forgiven is a
 * SPAN: `mười bảy giờ` → `17:00` is one substitution and two deletions, and each
 * one on its own looks like a word vanishing. Only the run says "three counting
 * words became one numeral".
 */
function editSpans(raw: readonly string[], repaired: readonly string[]): EditSpan[] {
  // Standard Levenshtein table over tokens. The dimensions are a turn's worth of
  // words — an 8s ceiling bounds this at a few dozen per side — so the quadratic
  // cost is irrelevant and a cleverer algorithm would only be harder to read.
  const rows = raw.length;
  const columns = repaired.length;
  const distance: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let i = 0; i <= rows; i++) distance[i]![0] = i;
  for (let j = 0; j <= columns; j++) distance[0]![j] = j;
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      const substitution = distance[i - 1]![j - 1]! + (raw[i - 1] === repaired[j - 1] ? 0 : 1);
      distance[i]![j] = Math.min(substitution, distance[i - 1]![j]! + 1, distance[i]![j - 1]! + 1);
    }
  }

  // Walk back to an operation sequence, then keep only the runs that are not
  // matches. Ties are resolved toward the diagonal so a rewrite reads as a
  // substitution rather than as a deletion beside an unrelated insertion — which
  // is what keeps the two sides of one span together.
  const spans: EditSpan[] = [];
  let current: EditSpan | null = null;
  const openSpan = (): EditSpan => (current ??= { raw: [], repaired: [], cost: 0, rawStart: 0 });
  const closeSpan = (): void => {
    if (current) spans.push(current);
    current = null;
  };
  // The walk is backwards, so each raw token consumed is further LEFT than the
  // last: whichever is recorded most recently is the span's true start.
  const takeRaw = (span: EditSpan, index: number): void => {
    span.raw.unshift(raw[index]!);
    span.rawStart = index;
  };

  let i = rows;
  let j = columns;
  while (i > 0 || j > 0) {
    const diagonal = i > 0 && j > 0 && distance[i]![j]! === distance[i - 1]![j - 1]!;
    if (diagonal && raw[i - 1] === repaired[j - 1]) {
      closeSpan();
      i--;
      j--;
      continue;
    }
    if (i > 0 && j > 0 && distance[i]![j]! === distance[i - 1]![j - 1]! + 1) {
      const span = openSpan();
      takeRaw(span, i - 1);
      span.repaired.unshift(repaired[j - 1]!);
      span.cost += 1;
      i--;
      j--;
    } else if (i > 0 && distance[i]![j]! === distance[i - 1]![j]! + 1) {
      const span = openSpan();
      takeRaw(span, i - 1);
      span.cost += 1;
      i--;
    } else {
      const span = openSpan();
      span.repaired.unshift(repaired[j - 1]!);
      span.cost += 1;
      j--;
    }
  }
  closeSpan();
  return spans;
}

/**
 * Whether this span is a number being written as a number.
 *
 * Three conditions, and each rules out a different way of being wrong.
 *
 *  - Every raw word must be number vocabulary. A span mixing `bảy` with a
 *    content word is scored in full: whatever else happened there, it was not
 *    only a number being rewritten.
 *  - At least one must be a COUNTING word, not merely filler. This is what stops
 *    `không phải` → `0 phải` being forgiven; see {@link NumberVocabulary}.
 *  - The repaired side must contain a digit. Without it, any run of short common
 *    words could be forgiven whatever it turned into.
 */
function isNumeralRewrite(
  span: EditSpan,
  rawTokens: readonly string[],
  vocabulary: NumberVocabulary,
): boolean {
  if (span.raw.length === 0) return false;
  const known = (token: string | undefined): boolean =>
    token !== undefined &&
    (vocabulary.counting.has(token) || vocabulary.filler.has(token) || hasDigit(token));
  if (!span.raw.every(known)) return false;

  // A `neverAlone` word is judged on what FOLLOWS it, before any vouching is
  // considered — because both vouching paths were shown to carry one through.
  // A spoken zero heads a longer number, so more number vocabulary comes next;
  // a negation is followed by the thing it negates, or by nothing.
  for (let offset = 0; offset < span.raw.length; offset++) {
    if (!vocabulary.neverAlone.has(span.raw[offset]!)) continue;
    if (!known(rawTokens[span.rawStart + offset + 1])) return false;
  }
  // The repaired side must be a numeral AND nothing but number vocabulary
  // around it. `some(hasDigit)` alone is not enough and the gap is exploitable:
  // `mười bảy giờ` → `17:00 chiều` contains a digit, is entirely counting words
  // on the raw side, and quietly smuggles in an afternoon nobody said. What is
  // being forgiven is a number written as a number, so anything else in the
  // span is not covered by that permission.
  if (!span.repaired.some(hasDigit)) return false;
  if (!span.repaired.every(known)) return false;

  // Vouched from inside: some word in the span is unambiguously a counting word.
  if (span.raw.some((token) => vocabulary.counting.has(token) || hasDigit(token))) return true;

  // Vouched from outside: the span is entirely ambiguous words, but it sits
  // directly against number vocabulary that the repair left ALONE. Measured on
  // the display corpus, this is what rescues three legitimate rewrites —
  // `cổng số ba` → `cổng số 3`, `ngày năm tháng một` → `ngày 5 tháng 1` and
  // `từ ba giờ` → `từ 3 giờ`, sitting against `số`, `ngày`/`tháng` and `giờ`.
  // Without it those three alone pushed the observed maximum residual from
  // 0.069 to 0.125, past where a single-word paraphrase lives.
  //
  // But a neighbour is weak evidence, and some words must not be convicted on
  // it. Requiring the neighbour to be a COUNTING word instead would be the
  // obvious tightening and is wrong: it breaks two of those three, since `số`,
  // `ngày` and `tháng` are all filler. So the restriction goes on the span
  // rather than the neighbour — see {@link NumberVocabulary.neverAlone}.
  if (span.raw.some((token) => vocabulary.neverAlone.has(token))) return false;

  const before = span.rawStart > 0 ? rawTokens[span.rawStart - 1] : undefined;
  const after = rawTokens[span.rawStart + span.raw.length];
  return known(before) || known(after);
}

export interface RepairDivergence {
  /** Non-exempt edit operations per raw word. 0 means only numerals moved. */
  residual: number;
  /** Raw words the residual is measured against; 0 means there was nothing to score. */
  rawWords: number;
  /** Edit operations forgiven as numeral rewrites, for reporting a rejection. */
  exemptedOps: number;
  /**
   * Whether this repair is close enough to the transcript to be shown.
   *
   * Carried on the result rather than offered as a second function, because a
   * caller needs BOTH — the verdict to decide, and the residual to record — and
   * two entry points meant the decision was written out twice: once here and
   * once inline wherever the number was already in hand. Two copies of a
   * threshold comparison is one copy too many when the thing it guards is
   * whether a word the speaker never said reaches the screen.
   */
  faithful: boolean;
}

/**
 * How far a repair strayed from the transcript, ignoring numeral rewrites.
 *
 * Directional: `raw` is what the recognizer produced and is the denominator,
 * because it is the thing the repair is answerable to.
 */
export function repairDivergence(
  raw: string,
  repaired: string,
  language: LanguageCode,
): RepairDivergence {
  const rawTokens = tokenize(raw);
  const repairedTokens = tokenize(repaired);
  const vocabulary = VOCABULARY[language] ?? VI;

  if (rawTokens.length === 0) {
    // Nothing to be answerable to. A repair that invented words here is entirely
    // invention, and one that produced none matches perfectly — both are decided
    // without dividing by zero.
    const residual = repairedTokens.length === 0 ? 0 : 1;
    return {
      residual,
      rawWords: 0,
      exemptedOps: 0,
      faithful: residual <= MAX_REPAIR_DIVERGENCE,
    };
  }

  let cost = 0;
  let exemptedOps = 0;
  for (const span of editSpans(rawTokens, repairedTokens)) {
    if (isNumeralRewrite(span, rawTokens, vocabulary)) exemptedOps += span.cost;
    else cost += span.cost;
  }

  const residual = cost / rawTokens.length;
  return {
    residual,
    rawWords: rawTokens.length,
    exemptedOps,
    faithful: residual <= MAX_REPAIR_DIVERGENCE,
  };
}

/**
 * Most a repair may diverge from the raw transcript, in non-numeral edits per
 * raw word, before it is discarded and the raw text shown instead.
 *
 * **Zero, and that is a measurement rather than a stance.** Every one of the 22
 * utterances in the display-fidelity corpus was repaired through the shipping
 * path — `gemma-4-31b-it`, the real provider, one speaker's own voice through
 * the real browser capture chain — and all 22 came back at a residual of exactly
 * 0.0000. Not near zero: zero.
 *
 *     node benchmarks/stt/scripts/repair_display_hypotheses.mjs
 *     min 0.0000  median 0.0000  p90 0.0000  max 0.0000   (22/22 exactly 0)
 *
 * So there is no tolerance to buy. A threshold is a bet that legitimate repairs
 * need room; these did not need any, and every point of room given away is a
 * paraphrase admitted — a single substituted word in a 24-word turn scores
 * 0.042, so even a small allowance would wave one through.
 *
 * That makes this constant the repair prompt's own rule 2 — "change no words" —
 * enforced arithmetically, with numeral rewrites exempted because those are the
 * one change the feature exists to make. It is written as a named constant
 * rather than inlined because it IS a calibration and could move; what would
 * move it is evidence that faithful repairs are being rejected, which the
 * `repair` metrics rows are instrumented to show.
 *
 * The asymmetry is why zero is the right side to err on. A rejection costs a
 * reader their punctuation for one turn. An acceptance puts a word on screen
 * that nobody said, attributed to the speaker, with nothing marking it.
 */
export const MAX_REPAIR_DIVERGENCE = 0;
