import { describe, expect, it } from 'vitest';
import { createTranslator, en, vi } from '@chatofy/i18n';
import { formatCredits, formatSignedCredits } from './credit-format';

describe('credit amounts', () => {
  const t = createTranslator(en);

  it('writes a debit with a true minus sign, not a hyphen', () => {
    expect(formatCredits(t, 'en', -12.5)).toBe('\u221212.5 credits');
    expect(formatSignedCredits(t, 'en', -12.5)).toBe('\u221212.5 credits');
    expect(formatSignedCredits(t, 'en', -1)).toBe('\u22121 credit');
  });

  it('signs an addition and leaves zero unsigned', () => {
    expect(formatSignedCredits(t, 'en', 120)).toBe('+120 credits');
    expect(formatSignedCredits(t, 'en', 0)).toBe('0 credits');
    expect(formatCredits(t, 'en', 1500)).toBe('1,500 credits');
  });

  it('keeps the minus sign and the local digits in Vietnamese', () => {
    const tv = createTranslator(vi);
    expect(formatSignedCredits(tv, 'vi', -1234.5)).toBe('\u22121.234,5 credit');
    expect(formatSignedCredits(tv, 'vi', 120)).toBe('+120 credit');
  });
});
