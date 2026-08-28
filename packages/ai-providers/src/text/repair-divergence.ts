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
// false-accept, never from reasoning about the code. Without "both sides",
// `mười bảy giờ` → `17:00 chiều` smuggles in an afternoon nobody said. Without
// the counting-word requirement, `không phải` ("not") → `0 phải` — the README's
// own motivating hallucination — scores a perfect zero, because `không` IS the
// word for zero. And the digit requirement is what makes these word lists safe
// to be as permissive as they are: `năm` is both "five" and "year", `ba` both
// "three" and "dad", and `ba` → `Ba Đình` reaches no digit and is scored in full.
//
// One class needed more than context could give: a word that is BOTH a numeral
// and an everyday word, digitized next to a number the repair is already
// rewriting. `nó không trăm phần trăm đúng` → `Nó 0 100 phần trăm đúng.` is
// ordinary Vietnamese with its meaning reversed, and every context rule tried
// against it failed, because the thing being negated is itself a number. What
// separates it is SHAPE rather than surroundings — see
// {@link NumberVocabulary.neverAlone}.
import { normalizeTranscript } from './vietnamese.js';
import { VOCABULARY, type NumberVocabulary } from './repair-number-vocabulary.js';
import type { LanguageCode } from '../interfaces/provider-types.js';

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
 * Four conditions, and each rules out a different way of being wrong.
 *
 *  - Every raw word must be number vocabulary. A span mixing `bảy` with a
 *    content word is scored in full: whatever else happened there, it was not
 *    only a number being rewritten.
 *  - No word may take a shape a genuine numeral never takes — a `neverAlone`
 *    word coming back as a bare digit of its own. Checked first, and consulting
 *    nothing outside the span, which is what makes it immune to how permissive
 *    the vouching below is; see {@link NumberVocabulary.neverAlone}.
 *  - The repaired side must contain a digit, and be number vocabulary
 *    throughout. Without the digit, any run of short common words could be
 *    forgiven whatever it turned into; without the rest, `17:00 chiều` smuggles
 *    in an afternoon nobody said.
 *  - The span must be VOUCHED as numeric — from inside by a counting word, or
 *    from outside by number vocabulary or a classifier sitting against it. This
 *    is what stops `không phải` → `0 phải` being forgiven while still allowing
 *    `cổng số ba` → `cổng số 3` and `ba người` → `3 người`.
 */
function isNumeralRewrite(
  span: EditSpan,
  rawTokens: readonly string[],
  vocabulary: NumberVocabulary,
): boolean {
  if (span.raw.length === 0) return false;
  // What may appear INSIDE a span, on either side of it. Deliberately narrower
  // than `vouches` below: this set bounds what a span is permitted to BECOME, so
  // every word added here is a word the repair may swap another one for.
  const inSpan = (token: string | undefined): boolean =>
    token !== undefined &&
    (vocabulary.counting.has(token) || vocabulary.filler.has(token) || hasDigit(token));
  // What counts as numeric CONTEXT outside a span. Wider, and safely so: a
  // neighbour is read, never rewritten, so it can only ever add evidence about
  // the span beside it. Adding `người` here rescues `ba người` → `3 người`;
  // adding it to `inSpan` instead would let `ba người` → `3 ngày` through.
  const vouches = (token: string | undefined): boolean =>
    inSpan(token) || (token !== undefined && vocabulary.neighbour.has(token));
  if (!span.raw.every(inSpan)) return false;

  // A `neverAlone` word may be absorbed into a numeral but never become one.
  // Checked before any vouching, because BOTH vouching paths were measured
  // carrying a digitized negation through — see {@link NumberVocabulary}.
  for (const token of span.raw) {
    const forbidden = vocabulary.neverAlone.get(token);
    if (forbidden !== undefined && span.repaired.includes(forbidden)) return false;
  }
  // The repaired side must be a numeral AND nothing but number vocabulary
  // around it. `some(hasDigit)` alone is not enough and the gap is exploitable:
  // `mười bảy giờ` → `17:00 chiều` contains a digit, is entirely counting words
  // on the raw side, and quietly smuggles in an afternoon nobody said. What is
  // being forgiven is a number written as a number, so anything else in the
  // span is not covered by that permission.
  if (!span.repaired.some(hasDigit)) return false;
  if (!span.repaired.every(inSpan)) return false;

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
  // Requiring the neighbour to be a COUNTING word instead would be the obvious
  // tightening and is wrong: it breaks two of those three, since `số`, `ngày`
  // and `tháng` are all filler. What the ambiguous words actually need is the
  // shape test above, which does not consult neighbours at all.
  //
  // The neighbour vocabulary is `vouches` rather than `inSpan`, which is what
  // admits the classifier a Vietnamese quantity is normally spoken with —
  // `ba người`, `năm tuổi`, `một cái`. All three were refused while this read
  // `inSpan`, and because the threshold is zero the refusal discarded the whole
  // turn's repair rather than that phrase. See {@link NumberVocabulary.neighbour}.
  const before = span.rawStart > 0 ? rawTokens[span.rawStart - 1] : undefined;
  const after = rawTokens[span.rawStart + span.raw.length];
  return vouches(before) || vouches(after);
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
  const vocabulary = VOCABULARY[language] ?? VOCABULARY.vi;

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
 * That evidence has arrived once, and the answer was not to move this. Ordinary
 * spoken quantities — `ba người`, `năm tuổi`, `một cái` — scored 0.20 to 0.33
 * because no classifier was in the vocabulary to vouch for the ambiguous numeral
 * beside it. Raising the threshold to admit them would have admitted a
 * single-word paraphrase in a short turn along with them, since 0.25 is exactly
 * what one substituted word in a four-word turn costs. Widening the EXEMPTION
 * instead — see {@link NumberVocabulary.neighbour} — bought back every one of
 * those at a residual of 0.0000, which is the shape a correct answer takes here:
 * the guard learns what a number looks like, it does not learn to tolerate.
 *
 * The asymmetry is why zero is the right side to err on. A rejection costs a
 * reader their punctuation for one turn. An acceptance puts a word on screen
 * that nobody said, attributed to the speaker, with nothing marking it.
 */
export const MAX_REPAIR_DIVERGENCE = 0;
