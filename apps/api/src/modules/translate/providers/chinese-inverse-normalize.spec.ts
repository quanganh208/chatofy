import { describe, expect, it } from 'vitest';
import { inverseNormalizeTranscript } from '@chatofy/ai-providers';

/**
 * The Chinese ITN as the display path reaches it: through the per-language
 * table, by language code. The scanner's own rules are specced beside it in
 * `packages/ai-providers`; this pins that `zh` is wired to it and that vi and en
 * did not move when the table became a table of functions.
 */
describe('inverseNormalizeTranscript (zh)', () => {
  const itn = (text: string) => inverseNormalizeTranscript(text, 'zh');

  it('typesets the numbers Paraformer writes as words', () => {
    expect(itn('它能向后兼容八零二点一一 a')).toBe('它能向后兼容802.11 a');
    expect(itn('到一九七六年马丘比丘的百分之三十得到修复')).toBe(
      '到1976年马丘比丘的30%得到修复',
    );
    expect(itn('消防救援人员最终在晚上十一点三十五分扑灭了大火')).toBe(
      '消防救援人员最终在晚上11:35扑灭了大火',
    );
  });

  it('reads punctuated (restored) text the same way', () => {
    expect(itn('大桥预计将于二零一七年九月全面投入使用，届时完工。')).toBe(
      '大桥预计将于2017年9月全面投入使用，届时完工。',
    );
  });

  it('returns text with no number byte for byte', () => {
    const text = '写博客是一种能够激发合作的工具';
    expect(itn(text)).toBe(text);
  });

  it('leaves the vi and en entries reading as before', () => {
    expect(inverseNormalizeTranscript('hai mươi lăm', 'vi')).toBe('25');
    expect(inverseNormalizeTranscript('twenty five', 'en')).toBe('25');
  });
});
