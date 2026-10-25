// Typesets the spoken numbers in a Chinese transcript as digits.
//
// Chinese cannot use the shared engine in `inverse-normalize.ts`: its tokenizer
// reads a `[\p{L}\p{M}]+` run as one word, and an unspaced Chinese clause is one
// such run, so no rule could ever see a number inside it. This is a character
// scanner instead, and it keeps the engine's two invariants: a candidate span
// yields exactly one numeral or nothing (never `2000 500`), and text with no
// number in it comes back byte for byte.
//
// Paraformer writes every number as words (`八零二点一一`, `十到六十分钟`), so
// without this a zh display would show no digit at all.
import { NUMBER_CHARACTER, chineseCardinal, digitRunValue } from './chinese-number-grammar.js';
import { DIGIT, NUM, SPAN_RULES } from './chinese-number-span-rules.js';

/**
 * Spans that are words, not numbers, when they are the WHOLE candidate span.
 *
 * Whole-span equality, not containment: `三点五十分` contains `十分` ("very")
 * and is still the time 3:50, and `三千万` contains `千万` ("by all means") and is
 * still 3000万. Most entries are a single numeral character next to a word
 * (`一样`, `第一`), which the single-character rule already keeps; they are
 * listed so the list says what it protects.
 */
const ABSTAIN_WORDS = [
  '一样',
  '一起',
  '一直',
  '一些',
  '一下',
  '一定',
  '一般',
  '一切',
  '一边',
  '一会儿',
  '万一',
  '十分',
  '千万',
  '统一',
  '唯一',
  '三心二意',
  '一五一十',
  '一一',
  '第一',
  '第二',
  '第三',
  '第四',
  '第五',
  '第六',
  '第七',
  '第八',
  '第九',
  '第十',
];

/**
 * Idioms that a span rule would otherwise read as a number, copied through
 * whole wherever they start: `一点一滴` ("bit by bit") is not the decimal 1.1.
 */
const VERBATIM = ['一点一滴', '一点一点', '十万八千里', '七七八八', '三五成群', '五五开'];

/** Each abstain word, as the numeral characters inside it and where they start. */
const ABSTAIN_CORES = ABSTAIN_WORDS.map((word) => {
  const start = [...word].findIndex((character) => NUMBER_CHARACTER.test(character));
  const core = word.slice(start).match(new RegExp(`^${NUM}+`, 'u'))?.[0] ?? '';
  return { word, start, core };
});

function isAbstainWord(text: string, at: number, span: string): boolean {
  return ABSTAIN_CORES.some(
    ({ word, start, core }) => core === span && text.startsWith(word, at - start),
  );
}

/**
 * A bare run of exactly two digit characters is an estimate or an idiom far
 * more often than a number: `三四个` "three or four", `三五个人` "three to five
 * people", `五五开` "fifty-fifty". A real digit string from Paraformer is three
 * characters or more (`八零二`, `一九九零`), and a two-digit number a span rule
 * can vouch for — a score `二五比二三`, a date, a time — is read by that rule
 * before a bare run is ever considered.
 */
function isEstimate(run: string): boolean {
  return digitRunValue(run)?.length === 2;
}

/** A cardinal as Chinese typesets it: `3万`, `3000万`, `1亿`, else plain digits. */
function formatCardinal(value: number, span: string): string {
  if (span.endsWith('亿')) return `${value / 100_000_000}亿`;
  if (span.endsWith('万')) {
    const yi = Math.floor(value / 100_000_000);
    const wan = (value % 100_000_000) / 10_000;
    return yi > 0 ? `${yi}亿${wan}万` : `${wan}万`;
  }
  return String(value);
}

/** A bare run: a digit run (`一九九零` → 1990) or a cardinal (`一百二十三` → 123). */
function bareRun(text: string, at: number, run: string): string | undefined {
  // One character is a word far more often than a number: 一样, 两种, 十分钟.
  if ([...run].length < 2 || isAbstainWord(text, at, run) || isEstimate(run)) return undefined;
  // A number followed by 点 that no rule above read is not one we understand.
  if (text[at + run.length] === '点') return undefined;
  const digits = digitRunValue(run);
  if (digits !== undefined) return digits;
  // A digit run scaled by 万/亿 (`四八万`): the recognizer's own shorthand.
  const scaled = run.match(new RegExp(`^(${DIGIT}{2,})([万亿])$`, 'u'));
  if (scaled) return `${digitRunValue(scaled[1] ?? '')}${scaled[2]}`;
  const value = chineseCardinal(run);
  return value === null ? undefined : formatCardinal(value, run);
}

const RUN = new RegExp(`${NUM}+`, 'uy');

/**
 * Typeset the spoken numbers in a Chinese transcript, changing nothing else.
 *
 * Pure and total. Latin text is never touched, and a span this cannot read with
 * certainty stays as written.
 */
export function chineseInverseNormalize(text: string): string {
  if (!NUMBER_CHARACTER.test(text)) return text;
  let out = '';
  let at = 0;
  while (at < text.length) {
    const character = text[at] ?? '';
    if (!NUMBER_CHARACTER.test(character)) {
      out += character;
      at += 1;
      continue;
    }
    const idiom = VERBATIM.find((word) => text.startsWith(word, at));
    let typeset: { text: string; length: number } | undefined = idiom
      ? { text: idiom, length: idiom.length }
      : undefined;
    for (const [pattern, rule] of typeset ? [] : SPAN_RULES) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      const value = match ? rule(match) : undefined;
      if (match && value !== undefined) {
        typeset = { text: value, length: match[0].length };
        break;
      }
    }
    if (!typeset) {
      RUN.lastIndex = at;
      const run = RUN.exec(text)?.[0] ?? character;
      typeset = { text: bareRun(text, at, run) ?? run, length: run.length };
    }
    out += typeset.text;
    at += typeset.length;
  }
  return out;
}
