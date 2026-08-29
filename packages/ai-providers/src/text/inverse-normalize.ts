// Spoken number words -> digits, deterministically, in process, before the line
// is ever painted.
//
// This replaces a second LLM request that rewrote a finished turn 10-92 seconds
// after the reader had already seen it (median 25.1s over 22 utterances, and not
// one repair in 22 landed inside 10 seconds). A remote model was never the only
// way to get digits — it was the only way anyone had tried. This is a pure
// function of a string: no network, no key, no second event, no variance.
//
// The engine here is language-neutral and holds the parts that are genuinely
// shared: how a string is cut into words and put back together, the left-to-
// right rule driver, the `neverAlone` safety check, and digit-group formatting.
// Everything that is a fact about a LANGUAGE — which words are numbers, what a
// date looks like, whether a scale word is written or spoken — lives in
// `vietnamese-inverse-normalize.ts` and `english-inverse-normalize.ts`. The
// display path is bidirectional and always was, so both directions get one.
//
// ## The rule the whole design turns on
//
//     One candidate span yields exactly one numeral, or nothing. Never a
//     fragment.
//
// The previous prototype emitted `2.000 500` for `hai nghìn năm trăm` — not a
// missing backtracker but a PARTIAL-PARSE EMISSION: it consumed `hai nghìn`,
// failed to attach `năm trăm`, and printed both halves. So a rule here either
// consumes its whole span and returns one numeral, or returns null and the words
// survive untouched. Ambiguity becomes recall loss, never a wrong digit, and
// that trade is deliberate: recall is a number in a table, a hallucination is a
// wrong sentence on someone's screen — and for `không` it is a REVERSED one, in
// the speaker's own words, with nothing marking it.
import { normalizeTranscript } from './vietnamese.js';

/**
 * A word may only be part of a numeral, or evidence for one, or neither.
 *
 * **These are not the divergence guard's tiers, and reusing those was measured
 * to be wrong.** The guard answers *may this word appear on the repaired side
 * without counting as paraphrase?*; a generator answers *does this word belong
 * INSIDE a numeral?* Those are different predicates, and the guard's `filler`
 * conflates two disjoint kinds of word: genuine numerals (`không`, `một`, `ba`)
 * and the nouns and units a numeral merely sits beside (`số`, `đồng`, `ngày`).
 *
 * Feeding the guard's tiers to a generator, with whole-span-or-abstain refusing
 * any parse that does not consume its span, loses **12 of 42 corpus numerals —
 * a recall ceiling of 30/42 = 0.714** against a bar of 0.8810, because spans
 * swallow `số`/`đồng`/`phần` and then cannot parse. Two of those failures are
 * structural rather than marginal:
 *
 *     cổng số ba          `số` and `ba` both filler -> zero anchors
 *     ngày năm tháng một  all four filler           -> zero anchors
 *
 * The second is fatal on its own: a date built entirely from ambiguous numerals
 * gets no span at all, and `ngày 05/01` is precisely what this exists to
 * produce. It only looks like it works on `ngày mười tháng hai`, where `mười`
 * and `hai` happen to land in `counting`.
 */
export interface NumberTiers {
  /** May be consumed as part of a numeral. */
  inside: Set<string>;
  /**
   * Numeric CONTEXT. Read only beside a span, never consumed into one.
   *
   * These are the classifiers, units and nouns a quantity is spoken with rather
   * than made of. Letting one travel inside a span is how `ba người` becomes
   * `3 ngày` — both sides entirely number vocabulary, a digit present, and a
   * word on screen that nobody said.
   */
  outside: Set<string>;
  /**
   * The subset of {@link outside} strong enough to vouch for an AMBIGUOUS
   * numeral standing alone.
   *
   * True classifiers and measure words (`người`, `cái`, `chiếc`, `lần`) say a
   * quantity is being counted. Positional nouns (`phòng`, `tầng`, `trang`,
   * `chỗ`, `điểm`) do not: what follows one of those is as often a NAME as a
   * number, and `phòng Ba Le` -> `phòng 3 Le` was measured on held-out speech.
   * They stay in `outside` — enough to vouch for an unambiguous digit like
   * `tầng bảy` -> `tầng 7` — without being enough to turn `ba` into 3.
   */
  strong: Set<string>;
  /**
   * Words that anchor a span even when every numeral in it is ambiguous.
   *
   * This is what makes `ngày năm tháng một` reachable at all.
   */
  anchors: Set<string>;
  /**
   * Digits that are far commoner as ordinary words, and so may not be the only
   * thing a span rests on.
   */
  ambiguous: Set<string>;
  /**
   * Words that, following a {@link neverAlone} word, prove it is interior to a
   * numeral rather than the ordinary word it usually is.
   *
   * Scale words only: `không trăm` is the empty hundreds place of a year,
   * `không đủ` is a negation.
   */
  interiorAfter: Set<string>;
  /**
   * Words that vouch for an AMBIGUOUS numeral from the LEFT.
   *
   * Vietnamese puts a classifier or unit AFTER the number it belongs to, so a
   * unit sitting before one is the tail of the PREVIOUS quantity and vouches for
   * nothing: `850.000 đồng một đêm` is "a night", not "1 night", and reading
   * `đồng` as evidence typeset the article. Only an identifier marker genuinely
   * introduces a following number — `số 4472`, `cổng số 3`.
   */
  leftMarkers: Set<string>;
  /**
   * Words that must never come back as a bare numeral of their own, mapped to
   * the numeral each must not become.
   *
   * Checked FIRST and consulting nothing outside the span, because what
   * separates these cases is not context but SHAPE: a spoken zero is absorbed
   * into the numeral it belongs to (`không phẩy bốn` -> `0,4`) and never comes
   * back standing alone. A digitized negation always does, since there is no
   * number for it to join.
   */
  neverAlone: Map<string, string>;
}

/** One consumed span and the text that replaces it. */
export interface Match {
  /** Exclusive word index where the span ends. */
  end: number;
  text: string;
}

export interface Context {
  /** Original-cased words. */
  words: string[];
  /** Case-folded words, what every rule matches on. */
  lower: string[];
  tiers: NumberTiers;
  /**
   * Exclusive upper bound a span starting at the current index may reach.
   *
   * Set by the driver from the separators: a span may cross plain whitespace and
   * nothing else, so a numeral can never be assembled across a comma, a full
   * stop, or a line break.
   */
  limit: number;
}

export type Rule = (context: Context, start: number) => Match | null;

export interface LanguageItn {
  tiers: NumberTiers;
  /** Tried in order at every position; first match wins and consumes. */
  rules: Rule[];
}

/**
 * Words, and the separators between them, kept apart so the string can be
 * rebuilt exactly.
 *
 * `gaps[i]` precedes `words[i]`; `gaps[words.length]` is whatever trails the
 * last word. A span replaces a run of words, keeps the gap before it and the gap
 * after it, and drops the interior ones — which is only sound because the driver
 * refuses to let a span cross a gap that is not pure whitespace.
 */
interface Tokenized {
  words: string[];
  gaps: string[];
}

// Letters and combining marks, plus the intra-word apostrophe English needs for
// `o'clock`. Digits are deliberately NOT word characters: an already-typeset
// numeral must survive untouched rather than be re-read as material.
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

const WHITESPACE_ONLY = /^\s*$/;

/** A maximal digit run plus the separators that sit BETWEEN digits. */
const NUMERAL_RUN = /\d+(?:[.,:/]\d+)*/g;

function tokenize(text: string): Tokenized {
  const words: string[] = [];
  const gaps: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(WORD)) {
    gaps.push(text.slice(cursor, match.index));
    words.push(match[0]);
    cursor = match.index + match[0].length;
  }
  gaps.push(text.slice(cursor));
  return { words, gaps };
}

/**
 * Group thousands with a dot: `2500` -> `2.500`.
 *
 * Vietnamese writes the dot where English writes a comma, and the comma is
 * already spoken for as the decimal mark.
 */
export function groupThousands(value: string, separator: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * Does `numeral` stand alone anywhere in `text` as a complete numeral?
 *
 * The test is deliberately over the whole maximal run, not a substring: `0` is
 * standing alone in `0 phải` and is not in `0,4`, `0883` or `10`.
 */
function standsAlone(text: string, numeral: string): boolean {
  return [...text.matchAll(NUMERAL_RUN)].some((match) => match[0] === numeral);
}

/**
 * Would this replacement turn a word into a bare numeral it must never become?
 *
 * One line, no context, checked before any output is accepted. It subsumes all
 * three separately-measured holes the guard needed — `tôi không đồng ý`,
 * `hai mươi không đủ`, `nó không trăm phần trăm đúng` — which is why widening
 * the neighbour evidence can never reopen them.
 */
function violatesNeverAlone(tiers: NumberTiers, source: string[], produced: string): boolean {
  for (const [word, numeral] of tiers.neverAlone) {
    if (source.includes(word) && standsAlone(produced, numeral)) return true;
  }
  return false;
}

/**
 * Rewrite spoken numbers as digits, leaving every other word exactly as spoken.
 *
 * Total on any string: an input with no numbers in it comes back byte-identical,
 * which is what lets the caller emit a display value only when something
 * actually changed.
 */
export function inverseNormalize(text: string, language: LanguageItn): string {
  // `normalizeTranscript` and never `foldForMatch`: the latter strips diacritics
  // and is lossy by design, so it must never reach a screen.
  const normalized = normalizeTranscript(text);
  const { words, gaps } = tokenize(normalized);
  const lower = words.map((word) => word.toLowerCase());

  const out: string[] = [];
  let index = 0;
  while (index < words.length) {
    // How far a span starting here may reach before it would have to cross
    // something that is not whitespace.
    let limit = index + 1;
    while (limit < words.length && WHITESPACE_ONLY.test(gaps[limit] ?? '')) limit += 1;

    const context: Context = { words, lower, tiers: language.tiers, limit };
    let matched: Match | null = null;
    for (const rule of language.rules) {
      const candidate = rule(context, index);
      if (!candidate) continue;
      if (violatesNeverAlone(language.tiers, lower.slice(index, candidate.end), candidate.text)) {
        // Refused outright rather than retried shorter. A shorter span of the
        // same words is the same digitization with less evidence behind it.
        continue;
      }
      matched = candidate;
      break;
    }

    if (matched) {
      out.push(gaps[index] ?? '', matched.text);
      index = matched.end;
      continue;
    }

    // Nothing understood this run, so nothing may be taken from part of it.
    // Advancing one word instead would retry from the middle and publish a
    // numeral built from a tail the whole could not account for: measured,
    // `mười một mười hai mười ba` came back as `MƯỜI MỘT MƯỜI HAI 13`, three
    // spoken numbers of which one is typeset. Skipping the run keeps
    // whole-span-or-abstain true of the DRIVER and not only of each grammar.
    const runEnd = runOf(context, index);
    const stop = Math.max(runEnd, index + 1);
    for (let at = index; at < stop; at += 1) out.push(gaps[at] ?? '', words[at] ?? '');
    index = stop;
  }
  out.push(gaps[words.length] ?? '');
  return out.join('');
}

/**
 * The case-folded word at `index`, or `''` past either end.
 *
 * Out of range is not an error here: rules routinely look one word past a span
 * to ask what follows it, and the answer at the end of a transcript is "nothing"
 * — which no tier contains, so every membership test falls through correctly.
 */
export function wordAt(context: Context, index: number): string {
  return context.lower[index] ?? '';
}

/** The original-cased word at `index`, or `''` past either end. */
export function rawAt(context: Context, index: number): string {
  return context.words[index] ?? '';
}

/** Is the word at `index` inside the span's reach and consumable? */
export function isInside(context: Context, index: number): boolean {
  return index < context.limit && context.tiers.inside.has(wordAt(context, index));
}

/**
 * The longest run of consumable words starting at `start`, bounded by the span
 * limit.
 *
 * Growth is separated from parsing on purpose: the segmenter makes no value
 * decisions at all, so a grammar can never be handed a span it half-understands.
 *
 * **A `neverAlone` word stops growth unless it starts the span.** Those words
 * are only ever absorbed into a numeral they BEGIN — `không phẩy bốn` -> `0,4`,
 * `không tám tám ba` -> `0883` — so one appearing mid-span is not part of the
 * number. Without this, `hai mươi không đủ` grows one span, parses to 20, and
 * silently DELETES the negation: a worse outcome than the `20 0 đủ` this design
 * exists to prevent, because nothing on screen marks it. Stopping here instead
 * yields `20 không đủ`, digitizing what was a number and leaving what was not.
 *
 * It is also why `số không không tám` -> `Số 0 0 8` stays as words. That cost is
 * accepted and documented: a separated digit readout is rare, and a reader can
 * recover it — a reversed sentence they cannot.
 */
export function runOf(context: Context, start: number): number {
  let end = start;
  while (isInside(context, end)) {
    if (end > start && context.tiers.neverAlone.has(wordAt(context, end))) {
      // ...unless a SCALE word follows it, which is the one shape where such a
      // word really is interior to a numeral: `hai nghìn không trăm hai mươi
      // sáu` = 2026, where `không trăm` is the empty hundreds place and is how
      // Vietnamese says every year from 2001 to 2099. `không` before an ordinary
      // word (`không đủ`, `không phải`) is the negation and still stops growth.
      if (!context.tiers.interiorAfter.has(wordAt(context, end + 1))) break;
    }
    end += 1;
  }
  return end;
}

/**
 * Does a numeric-context word sit immediately either side of the span?
 *
 * `strong` narrows the evidence to true classifiers and measure words, which is
 * what an AMBIGUOUS numeral needs before it may stand alone as a digit.
 */
export function hasNumericNeighbour(
  context: Context,
  start: number,
  end: number,
  strong = false,
): boolean {
  const before = start > 0 ? wordAt(context, start - 1) : null;
  const after = end < context.words.length ? wordAt(context, end) : null;
  const pool = strong ? context.tiers.strong : context.tiers.outside;
  const evidence = (word: string | null) =>
    word !== null && (pool.has(word) || (!strong && context.tiers.anchors.has(word)));

  // An ambiguous numeral is only vouched for from the LEFT by a marker that
  // genuinely introduces a number. Everything else on that side belongs to the
  // quantity before it.
  if (strong) {
    return evidence(after) || (before !== null && context.tiers.leftMarkers.has(before));
  }
  return evidence(before) || evidence(after);
}
