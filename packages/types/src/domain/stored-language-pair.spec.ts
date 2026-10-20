import { describe, expect, it } from 'vitest';
import { languagePairFromStoredDirection } from './stored-language-pair.js';

describe('languagePairFromStoredDirection', () => {
  it('reads every pair the old setting could hold', () => {
    expect(languagePairFromStoredDirection('vi_to_en')).toEqual({ source: 'vi', target: 'en' });
    expect(languagePairFromStoredDirection('en_to_zh')).toEqual({ source: 'en', target: 'zh' });
    expect(languagePairFromStoredDirection('zh_to_vi')).toEqual({ source: 'zh', target: 'vi' });
  });

  it('names no pair for anything else', () => {
    expect(languagePairFromStoredDirection('xx_to_vi')).toBeNull();
    expect(languagePairFromStoredDirection('vi_to_vi')).toBeNull();
    expect(languagePairFromStoredDirection('vi-en')).toBeNull();
    expect(languagePairFromStoredDirection('')).toBeNull();
    expect(languagePairFromStoredDirection(undefined)).toBeNull();
    expect(languagePairFromStoredDirection({ source: 'vi', target: 'en' })).toBeNull();
  });
});
