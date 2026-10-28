import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, isHexColor, luminance } from './color-contrast';

describe('contrastRatio', () => {
  it('spans 1 to 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('does not care which colour is the ink', () => {
    expect(contrastRatio('#1c1917', '#f5f5f4')).toBe(contrastRatio('#f5f5f4', '#1c1917'));
  });

  it('matches a pair the design docs record', () => {
    // `text` on `bg`, both themes, as docs/design-guidelines.md records them.
    expect(contrastRatio('#1C1917', '#F5F5F4')).toBeCloseTo(16.03, 2);
    expect(contrastRatio('#F5F5F4', '#0C0A09')).toBeCloseTo(18.11, 2);
  });
});

describe('luminance', () => {
  it('reads upper and lower case alike', () => {
    expect(luminance('#ABCDEF')).toBe(luminance('#abcdef'));
  });
});

describe('composite', () => {
  it('is the ink at full opacity and the ground at none', () => {
    expect(composite('#123456', '#ffffff', 1)).toBe('#123456');
    expect(composite('#123456', '#ffffff', 0)).toBe('#ffffff');
  });

  it('lands halfway at half', () => {
    expect(composite('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('isHexColor', () => {
  it('accepts six digits and nothing else', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('a1b2c3')).toBe(false);
    expect(isHexColor('#a1b2c3ff')).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });
});
