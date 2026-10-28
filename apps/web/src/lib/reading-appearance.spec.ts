import { describe, expect, it } from 'vitest';
import { palettes, type ColorScheme } from '@chatofy/ui';
import { contrastRatio } from './color-contrast';
import {
  DEFAULT_READING_APPEARANCE,
  GROUND_PRESETS,
  INK_PRESETS,
  INK_SLOTS,
  READABLE_CONTRAST,
  appearanceVars,
  groundScheme,
  inkContrast,
  readingSchemeClass,
  type GroundPreset,
  type ReadingAppearance,
} from './reading-appearance';

const SCHEMES: ColorScheme[] = ['light', 'dark'];
const with_ = (patch: Partial<ReadingAppearance>): ReadingAppearance => ({
  ...DEFAULT_READING_APPEARANCE,
  ...patch,
});

/** The scheme a ground paints in: its own when it forces one, the theme's otherwise. */
const paintsIn = (ground: GroundPreset, theme: ColorScheme): ColorScheme =>
  groundScheme(ground) ?? theme;

describe('the presets clear the reading floor', () => {
  it.each(SCHEMES)('every ink on the %s surface', (scheme) => {
    for (const [name, pair] of Object.entries(INK_PRESETS)) {
      expect(
        contrastRatio(pair[scheme], palettes[scheme].surface),
        `${name} on ${scheme} surface`,
      ).toBeGreaterThanOrEqual(READABLE_CONTRAST);
    }
  });

  it.each(SCHEMES)('every ink on every ground, under the %s theme', (theme) => {
    for (const [ground, groundPair] of Object.entries(GROUND_PRESETS)) {
      const scheme = paintsIn(ground as GroundPreset, theme);
      for (const [ink, pair] of Object.entries(INK_PRESETS)) {
        expect(
          contrastRatio(pair[scheme], groundPair[scheme]),
          `${ink} on ${ground} (${theme})`,
        ).toBeGreaterThanOrEqual(READABLE_CONTRAST);
      }
    }
  });

  it.each(SCHEMES)('the default text and hints on every ground, under %s', (theme) => {
    // A ground nobody chose an ink for is read in the theme's own tokens.
    for (const [ground, pair] of Object.entries(GROUND_PRESETS)) {
      const scheme = paintsIn(ground as GroundPreset, theme);
      for (const token of ['text', 'textSecondary', 'textMuted'] as const) {
        expect(
          contrastRatio(palettes[scheme][token], pair[scheme]),
          `${token} on ${ground} (${theme})`,
        ).toBeGreaterThanOrEqual(READABLE_CONTRAST);
      }
    }
  });
});

describe('groundScheme', () => {
  it('forces dark under a dark fixed ground and light under a light one', () => {
    expect(groundScheme('black')).toBe('dark');
    expect(groundScheme('navy')).toBe('dark');
    expect(groundScheme('white')).toBe('light');
    expect(groundScheme('#101010')).toBe('dark');
    expect(groundScheme('#fafafa')).toBe('light');
  });

  it('stops forcing a scheme once the page mostly shows through', () => {
    // Black at 30% over the light page is drawn light grey; dark-set ink on it
    // would be the unreadable default.
    expect(groundScheme('black', 30)).toBeNull();
    expect(groundScheme('black', 60)).toBe('dark');
    expect(
      readingSchemeClass(with_({ background: 'black', backgroundOpacity: 30 })),
    ).toBeUndefined();
  });

  it('leaves the theme alone for an adaptive ground or none', () => {
    expect(groundScheme('cream')).toBeNull();
    expect(groundScheme('default')).toBeNull();
  });
});

describe('appearanceVars', () => {
  it('writes nothing for the default look, so the old transcript is untouched', () => {
    expect(appearanceVars(DEFAULT_READING_APPEARANCE)).toEqual({});
  });

  it('writes a preset as a pair that follows the theme', () => {
    expect(appearanceVars(with_({ targetColor: 'amber' }))['--reading-target']).toBe(
      'light-dark(#8A4B00, #F2B54B)',
    );
  });

  it('writes a custom hex as it is', () => {
    expect(appearanceVars(with_({ timeColor: '#abcdef' }))['--reading-time']).toBe('#abcdef');
  });

  it('mixes a translucent background', () => {
    const vars = appearanceVars(with_({ background: 'black', backgroundOpacity: 40 }));
    expect(vars['--reading-bg']).toBe('color-mix(in srgb, #000000 40%, transparent)');
  });

  it('forces the scheme of a fixed ground by class, and leaves an adaptive one alone', () => {
    expect(readingSchemeClass(with_({ background: 'black' }))).toBe('reading-scheme-dark');
    expect(readingSchemeClass(with_({ background: '#fafafa' }))).toBe('reading-scheme-light');
    expect(readingSchemeClass(with_({ background: 'cream' }))).toBeUndefined();
    expect(readingSchemeClass(DEFAULT_READING_APPEARANCE)).toBeUndefined();
  });

  it('writes the typography only where it differs from the old look', () => {
    const vars = appearanceVars(
      with_({ font: 'mono', lineHeight: 'relaxed', targetWeight: 'bold', align: 'center' }),
    );
    expect(vars['--reading-font']).toContain('monospace');
    expect(vars['--reading-leading']).toBe('1.2');
    expect(vars['--reading-target-weight']).toBe('700');
    expect(vars['--reading-align']).toBe('center');
  });
});

describe('inkContrast', () => {
  it('passes every default ink on the default ground in both themes', () => {
    for (const slot of INK_SLOTS) {
      for (const scheme of SCHEMES) {
        const { ratio, failsInOtherScheme } = inkContrast(DEFAULT_READING_APPEARANCE, slot, scheme);
        expect(ratio).toBeGreaterThanOrEqual(READABLE_CONTRAST);
        expect(failsInOtherScheme).toBe(false);
      }
    }
  });

  it('flags a custom ink that is readable here and not in the other theme', () => {
    // Near-black: fine on the light page, invisible on the dark one.
    const result = inkContrast(with_({ targetColor: '#222222' }), 'targetColor', 'light');
    expect(result.ratio).toBeGreaterThan(READABLE_CONTRAST);
    expect(result.failsInOtherScheme).toBe(true);
  });

  it('measures against the composite of a translucent ground', () => {
    // Black at 50% over the light page is mid-grey, under which the dark scheme's
    // light text the black ground forces is no longer readable.
    const solid = inkContrast(with_({ background: 'black' }), 'targetColor', 'light');
    const half = inkContrast(
      with_({ background: 'black', backgroundOpacity: 50 }),
      'targetColor',
      'light',
    );
    expect(solid.ratio).toBeGreaterThan(READABLE_CONTRAST);
    expect(half.ratio).toBeLessThan(READABLE_CONTRAST);
  });

  it('agrees with the palette tokens it stands in for', () => {
    // `DEFAULT_INK` restates `text` and `textMuted`; if the tokens move, this does.
    const light = inkContrast(DEFAULT_READING_APPEARANCE, 'targetColor', 'light').ratio;
    expect(light).toBeCloseTo(contrastRatio(palettes.light.text, palettes.light.bg), 5);
    const dark = inkContrast(DEFAULT_READING_APPEARANCE, 'timeColor', 'dark').ratio;
    expect(dark).toBeCloseTo(contrastRatio(palettes.dark.textMuted, palettes.dark.bg), 5);
  });
});
