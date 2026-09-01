import { describe, expect, it } from 'vitest';
import { parseGlossaryCsv } from './parse-glossary-csv';

describe('parseGlossaryCsv', () => {
  it('parses plain rows with the default keepVerbatim false', () => {
    expect(parseGlossaryCsv('nhồi máu cơ tim,myocardial infarction')).toEqual([
      { vi: 'nhồi máu cơ tim', en: 'myocardial infarction', keepVerbatim: false },
    ]);
  });

  it('skips a header row naming the columns', () => {
    const csv = 'vi,en,keepVerbatim\ngan,liver,false';
    expect(parseGlossaryCsv(csv)).toEqual([{ vi: 'gan', en: 'liver', keepVerbatim: false }]);
  });

  it('reads keepVerbatim as true for true/1/yes, false otherwise', () => {
    const csv = 'Zalo,Zalo,true\nGrab,Grab,1\nMoMo,MoMo,yes\ntim,heart,false\nphổi,lung,';
    expect(parseGlossaryCsv(csv).map((t) => t.keepVerbatim)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('honors quoted fields with embedded commas and escaped quotes', () => {
    const csv = '"phẫu thuật, nội soi","laparoscopic surgery",false\n"a ""b"" c",d,';
    expect(parseGlossaryCsv(csv)).toEqual([
      { vi: 'phẫu thuật, nội soi', en: 'laparoscopic surgery', keepVerbatim: false },
      { vi: 'a "b" c', en: 'd', keepVerbatim: false },
    ]);
  });

  it('drops blank lines and rows missing a spelling', () => {
    const csv = 'gan,liver\n\n,orphan\nonly,\nthận,kidney\n';
    expect(parseGlossaryCsv(csv)).toEqual([
      { vi: 'gan', en: 'liver', keepVerbatim: false },
      { vi: 'thận', en: 'kidney', keepVerbatim: false },
    ]);
  });

  it('returns an empty list for an empty or header-only file', () => {
    expect(parseGlossaryCsv('')).toEqual([]);
    expect(parseGlossaryCsv('vi,en,keepVerbatim\n')).toEqual([]);
  });
});
