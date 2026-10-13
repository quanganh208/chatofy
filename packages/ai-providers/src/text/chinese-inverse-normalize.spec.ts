import { describe, expect, it } from 'vitest';
import { chineseCardinal, digitRunValue } from './chinese-number-grammar.js';
import { chineseInverseNormalize } from './chinese-inverse-normalize.js';

describe('chineseCardinal', () => {
  it.each([
    ['十', 10],
    ['十五', 15],
    ['二十', 20],
    ['一百零五', 105],
    ['一百二十三', 123],
    ['一千零十', 1010],
    ['两千', 2000],
    ['三万五千', 35000],
    ['十万一千', 101000],
    ['三千万', 30_000_000],
    ['一万零五', 10005],
    ['一亿', 100_000_000],
    ['三亿五千万', 350_000_000],
  ])('reads %s as %i', (text, value) => {
    expect(chineseCardinal(text)).toBe(value);
  });

  it.each(['十十', '三四', '两十', '一百五', '千万', '万一', '零五', '', '亿'])(
    'refuses %s',
    (text) => {
      expect(chineseCardinal(text)).toBeNull();
    },
  );
});

describe('digitRunValue', () => {
  it('reads a digit run one character at a time', () => {
    expect(digitRunValue('二零一三')).toBe('2013');
    expect(digitRunValue('幺三八')).toBe('138');
    expect(digitRunValue('〇〇七')).toBe('007');
  });

  it('refuses anything with a unit or 两 in it', () => {
    expect(digitRunValue('二十')).toBeUndefined();
    expect(digitRunValue('两三')).toBeUndefined();
  });
});

describe('chineseInverseNormalize', () => {
  it.each([
    // Cardinals with units, and 两 before a unit.
    ['一百二十三个', '123个'],
    ['三万', '3万'],
    ['三万五千', '35000'],
    ['两千人', '2000人'],
    // Digit-by-digit runs.
    ['二零一三年', '2013年'],
    ['幺三八', '138'],
    // Decimals.
    ['八零二点一一', '802.11'],
    ['三点五', '3.5'],
    // Percentages.
    ['百分之十五', '15%'],
    ['百分之三点五', '3.5%'],
    // Dates.
    ['十月十三号', '10月13号'],
    ['二零一七年九月', '2017年9月'],
    ['二月二十三日', '2月23日'],
    // Times.
    ['三点五十分', '3:50'],
    ['十点十分', '10:10'],
    ['三点十五', '3:15'],
    ['三点零五分', '3:05'],
    ['晚上十一点三十五分', '晚上11:35'],
  ])('typesets %s as %s', (spoken, written) => {
    expect(chineseInverseNormalize(spoken)).toBe(written);
  });

  it('leaves 三点半 as written', () => {
    expect(chineseInverseNormalize('三点半')).toBe('三点半');
  });

  it.each([
    // A span that CONTAINS an abstain word is still a number.
    ['三点五十分', '3:50'],
    ['十点十分', '10:10'],
    ['三千万', '3000万'],
    ['十万一千', '101000'],
    // A mark splits the span: no time forms across it, the lone 三 abstains and
    // 五十 is a cardinal.
    ['三点，五十分', '三点，50分'],
  ])('reads %s by its whole span as %s', (spoken, written) => {
    expect(chineseInverseNormalize(spoken)).toBe(written);
  });

  it.each([
    '十分',
    '千万',
    '万一',
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
    '统一',
    '唯一',
    '第一',
    '第十',
    '三心二意',
    '一五一十',
    '一一',
  ])('keeps the word %s as written', (word) => {
    expect(chineseInverseNormalize(word)).toBe(word);
  });

  it.each([
    // A single numeral character is a word far more often than a number.
    '水煮一分钟就足够了',
    '合金基本上由两种或以上金属混合而成',
    '十分钟以后',
    // Neighbouring digits a step apart are an estimate.
    '三四个人',
    '七八天',
    // Idioms a rule would otherwise read as a number.
    '一点一滴',
    '一点一点地',
    '不要忘记一点',
  ])('leaves %s as written', (text) => {
    expect(chineseInverseNormalize(text)).toBe(text);
  });

  it('touches nothing in a sentence with no numeral, byte for byte', () => {
    const text = '写博客是一种能够激发合作的工具，还能鼓励学生。';
    expect(chineseInverseNormalize(text)).toBe(text);
    const plain = '我们明天去北京开会';
    expect(chineseInverseNormalize(plain)).toBe(plain);
  });

  it('never touches Latin text', () => {
    expect(chineseInverseNormalize('八零二点一一 a 标准')).toBe('802.11 a 标准');
    expect(chineseInverseNormalize('iPhone 十五 Pro')).toBe('iPhone 15 Pro');
    expect(chineseInverseNormalize('version two')).toBe('version two');
  });

  it('typesets each span on its own, never across', () => {
    expect(
      chineseInverseNormalize('它能向后兼容八零二点一一 a 八零二点一一 b 和八零二点一一 g'),
    ).toBe('它能向后兼容802.11 a 802.11 b 和802.11 g');
  });

  it('typesets both sides of a range or a score, or neither', () => {
    expect(chineseInverseNormalize('十到六十分钟')).toBe('10到60分钟');
    expect(chineseInverseNormalize('最终中国队以二五比二三拿下第四局')).toBe(
      '最终中国队以25比23拿下第四局',
    );
    expect(chineseInverseNormalize('三至五天')).toBe('三至五天');
    expect(chineseInverseNormalize('一个比一个好')).toBe('一个比一个好');
  });
});
