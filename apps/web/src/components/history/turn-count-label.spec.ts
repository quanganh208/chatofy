import { createTranslator, en, vi } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';
import { turnCountLabel } from './turn-count-label';

describe('turnCountLabel', () => {
  it('writes the singular for one turn', () => {
    expect(turnCountLabel(createTranslator(en), 1)).toBe('1 turn');
    expect(turnCountLabel(createTranslator(vi), 1)).toBe('1 lượt');
  });

  it('writes the count for anything else', () => {
    expect(turnCountLabel(createTranslator(en), 2)).toBe('2 turns');
    expect(turnCountLabel(createTranslator(en), 0)).toBe('0 turns');
  });
});
