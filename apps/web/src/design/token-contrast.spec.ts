import { describe, expect, it } from 'vitest';
import { color } from '@chatofy/ui';

/**
 * The contrast claims in `docs/design-guidelines.md`, as assertions.
 *
 * That document records a measured ratio beside every colour, and until now the
 * measurements lived only in prose — a token could be changed to a value that
 * read well on a designer's monitor and quietly failed AA, with the doc still
 * confidently reporting the old number.
 *
 * Written when the accent moved from violet to cyan, which is exactly the change
 * that needed catching: the new fill is bright enough to be read on the page and
 * therefore too bright to carry white, so `onAccent` had to invert and
 * `onLiveFill` had to be split out for the red bars. Both of those are silent
 * failures. The pairs below are the ones where getting it backwards produces
 * text nobody can read on the control that stops a recording.
 *
 * WCAG 2.1 relative luminance. Web-only in location, not in scope: these are
 * shared tokens, and this app is the one with a test runner already pointed at
 * the design folder.
 */

/** WCAG relative luminance of an `#rrggbb` string. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const one = luminance(a);
  const other = luminance(b);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

/** AA for body text and for anything small. */
const TEXT = 4.5;
/** AA for a non-text component boundary — the edge of a control, a fill. */
const COMPONENT = 3;

describe('ink on a fill', () => {
  it.each([
    ['onAccent on accent', color.onAccent, color.accent],
    ['onAccent on accentHover', color.onAccent, color.accentHover],
    // The red fills keep white under their own token. Sharing `onAccent` with
    // them was survivable while both wanted white and stopped being survivable
    // the moment the accent wanted black.
    ['onLiveFill on liveFill', color.onLiveFill, color.liveFill],
    // `--destructive-foreground` maps to `onAccent` on web.
    ['onAccent on live', color.onAccent, color.live],
    ['text on accentSubtle', color.text, color.accentSubtle],
    ['text on warningSubtle', color.text, color.warningSubtle],
    ['text on liveSubtle', color.text, color.liveSubtle],
  ])('%s clears AA', (_name, ink, fill) => {
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(TEXT);
  });

  /**
   * A hover state is not a place to lose contrast — it is the moment someone has
   * committed to pressing the thing.
   */
  it('does not get worse on hover', () => {
    expect(contrast(color.onAccent, color.accentHover)).toBeGreaterThanOrEqual(
      contrast(color.onAccent, color.accent),
    );
  });
});

describe('text on a ground', () => {
  it.each([
    ['text', color.text],
    ['textSecondary', color.textSecondary],
    ['textMuted', color.textMuted],
    ['accentText', color.accentText],
    ['live', color.live],
    ['speaking', color.speaking],
  ])('%s clears AA on bg and on surface', (_name, ink) => {
    expect(contrast(ink, color.bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(ink, color.surface)).toBeGreaterThanOrEqual(TEXT);
  });

  /**
   * The focus ring is drawn at `outline-offset: 2px`, so the colour adjacent to
   * it is the ground, not the control it wraps. 3:1 there is what WCAG asks of a
   * non-text indicator — and it is the only requirement that holds, because a
   * ring measured against its own button would rule out ever drawing one in the
   * accent family.
   */
  it.each([
    ['bg', color.bg],
    ['surface', color.surface],
    ['surfaceRaised', color.surfaceRaised],
  ])('draws the focus ring clear of %s', (_name, ground) => {
    expect(contrast(color.accentText, ground)).toBeGreaterThanOrEqual(COMPONENT);
  });
});

describe('component boundaries', () => {
  it('keeps the accent fill perceivable on both grounds', () => {
    expect(contrast(color.accent, color.bg)).toBeGreaterThanOrEqual(COMPONENT);
    expect(contrast(color.accent, color.surface)).toBeGreaterThanOrEqual(COMPONENT);
  });

  it('keeps a control edge perceivable where a decorative one need not be', () => {
    expect(contrast(color.borderControl, color.surface)).toBeGreaterThanOrEqual(COMPONENT);
    expect(contrast(color.borderControl, color.surfaceRaised)).toBeGreaterThanOrEqual(COMPONENT);
  });
});
