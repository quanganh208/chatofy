import { describe, expect, it } from 'vitest';
import { foreignSpans, isVietnameseSyllable } from './vietnamese-syllable.js';

describe('isVietnameseSyllable', () => {
  it.each([
    'nghiêng',
    'khuya',
    'quốc',
    'gì',
    'giữa',
    'xoong',
    'Đường',
    'người',
    'khuỷu',
    'oản',
    'y',
    'TRỜI',
  ])('accepts %s', (word) => {
    expect(isVietnameseSyllable(word)).toBe(true);
  });

  it.each(['deep', 'fred', 'defec', 'interpol', 'vneid', 'internet', 'video', 'cm', 'f'])(
    'rejects %s',
    (word) => {
      expect(isVietnameseSyllable(word)).toBe(false);
    },
  );

  it('reads a decomposed spelling the same as a precomposed one', () => {
    expect(isVietnameseSyllable('nghie\u0302\u0300ng')).toBe(true);
  });
});

describe('foreignSpans', () => {
  it('joins adjacent foreign words into one span', () => {
    expect(foreignSpans('lợi dụng deep fred để lừa đảo')).toEqual([
      { text: 'deep fred', firstWord: 2, wordCount: 2 },
    ]);
  });

  it('never flags numbers, and a number ends a span', () => {
    expect(foreignSpans('gấp 4 lần defec 10 giây')).toEqual([
      { text: 'defec', firstWord: 3, wordCount: 1 },
    ]);
  });

  it('finds every span in a line', () => {
    expect(foreignSpans('hỗ trợ bởi defec và ai interpol cảnh báo').map((s) => s.text)).toEqual([
      'defec',
      'interpol',
    ]);
  });

  it('returns nothing for plain Vietnamese', () => {
    expect(foreignSpans('Cơ quan này còn ghi nhận tình trạng.')).toEqual([]);
  });
});
