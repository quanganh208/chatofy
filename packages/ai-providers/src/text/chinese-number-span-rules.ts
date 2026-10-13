// The span rules the Chinese ITN scanner tries at each position, in order:
// percentages, dates, times, ranges and decimals. Each reads one whole span or
// nothing. Kept apart from the scanner in `chinese-inverse-normalize.ts`, which
// owns the bare-run reading and what abstains.
import { DIGIT_RUN, chineseCardinal, digitRunValue } from './chinese-number-grammar.js';

/** Any character a spoken number is written with, as a regex class source. */
export const NUM = '[零〇一幺二两三四五六七八九十百千万亿]';
/** Only the digit characters, as a regex class source. */
export const DIGIT = '[零〇一幺二三四五六七八九]';

/** An integer part: a cardinal (`三`, `十五`) or a digit run (`八零二`). */
export function integerPart(text: string): string | undefined {
  if (DIGIT_RUN.test(text) && text.length > 1) return digitRunValue(text);
  const value = chineseCardinal(text);
  return value === null ? undefined : String(value);
}

const inRange = (text: string, low: number, high: number): number | undefined => {
  const value = text === '零' ? 0 : chineseCardinal(text);
  return value !== null && value >= low && value <= high ? value : undefined;
};

export type Rule = (match: RegExpExecArray) => string | undefined;

/** Tried in order at every position; the first that typesets wins. */
export const SPAN_RULES: [RegExp, Rule][] = [
  // 百分之十五 → 15%; 百分之三点五 → 3.5%
  [
    new RegExp(`百分之(${NUM}+?)(?:点(${DIGIT}+))?(?!${NUM}|点)`, 'uy'),
    ([, whole = '', fraction]) => {
      const value = integerPart(whole);
      if (value === undefined) return undefined;
      return fraction ? `${value}.${digitRunValue(fraction)}%` : `${value}%`;
    },
  ],
  // [二零一七年] 九月 [十三日/号], needing at least two of the three parts.
  [
    new RegExp(`(?:(${DIGIT}{2,4})年)?(${NUM}{1,3})月(?:(${NUM}{1,3})([日号]))?`, 'uy'),
    ([, year, month = '', day, mark]) => {
      if (!year && !day) return undefined;
      const m = inRange(month, 1, 12);
      const d = day === undefined ? undefined : inRange(day, 1, 31);
      if (m === undefined || (day !== undefined && d === undefined)) return undefined;
      return `${year ? `${digitRunValue(year)}年` : ''}${m}月${d === undefined ? '' : `${d}${mark}`}`;
    },
  ],
  // 三点五十分 → 3:50; 三点十五 → 3:15 (a minute with 十 cannot be a decimal).
  [
    new RegExp(
      `(${NUM}{1,3})点(零?${NUM}{1,3}?)(分(?!钟)|(?=[^零〇一幺二三四五六七八九十]|$))`,
      'uy',
    ),
    ([, hour = '', minute = '', unit]) => {
      if (!unit && !minute.includes('十')) return undefined;
      const h = inRange(hour, 0, 24);
      const m = minute.startsWith('零') ? inRange(minute.slice(1), 1, 9) : inRange(minute, 0, 59);
      if (h === undefined || m === undefined) return undefined;
      return `${h}:${String(m).padStart(2, '0')}`;
    },
  ],
  // 十到六十 → 10到60; 二五比二三 → 25比23. Both sides or neither: the pair says
  // these are numbers, where alone a lone 十 or an estimate-shaped 二三 would
  // abstain and leave the range half typeset. One side must be two characters
  // or more, so `一比一个` stays a word.
  [
    new RegExp(`(${NUM}{1,4}?)([到至比])(${NUM}{1,4})(?!${NUM}|点)`, 'uy'),
    ([, left = '', joiner, right = '']) => {
      if ([...left].length < 2 && [...right].length < 2) return undefined;
      const from = integerPart(left);
      const to = integerPart(right);
      return from === undefined || to === undefined ? undefined : `${from}${joiner}${to}`;
    },
  ],
  // 八零二点一一 → 802.11; 三点五 → 3.5. Not before 分 (a time) or 点 (一点一点).
  [
    new RegExp(`(${NUM}+)点(${DIGIT}+)(?![分点]|${NUM})`, 'uy'),
    ([, whole = '', fraction = '']) => {
      const value = integerPart(whole);
      return value === undefined ? undefined : `${value}.${digitRunValue(fraction)}`;
    },
  ],
];
