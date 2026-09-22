import { describe, expect, it } from 'vitest';
import { brandMark, brandWordmark, color, colorLight, dawn } from './index.js';

/**
 * The lotus geometry is read by three builders that cannot share code — the React
 * component, the overlay's DOM-built copy, and the asset exporter — so its shape is
 * the contract between them.
 */
describe('brandMark', () => {
  it('describes two petal paths on a 64-unit square', () => {
    expect(brandMark.viewBox).toBe(64);
    for (const path of [brandMark.midPath, brandMark.sidePath]) {
      expect(path).toMatch(/^M[\d .C]+Z$/);
    }
    expect(brandMark.base).toEqual([32, 52]);
    expect(brandMark.sideAngle).toBe(42);
  });

  it('cuts a wider gap in the one-colour mark, so it survives 16px', () => {
    expect(brandMark.gapWidthInk).toBeGreaterThan(brandMark.gapWidth);
  });

  it('draws the centre petal in the dawn trio, in order', () => {
    expect(brandMark.stops).toEqual({ tip: dawn.peach, body: dawn.lavender, root: dawn.mint });
    expect(brandMark.sideStops.left.from).toBe(dawn.mint);
    expect(brandMark.sideStops.right.from).toBe(dawn.lavender);
  });

  it('inks with the text colour of each scheme, and tiles on the dark ground', () => {
    expect(brandMark.ink).toEqual({ light: colorLight.text, dark: color.text });
    expect(brandMark.tile).toBe(color.bg);
  });
});

describe('brandWordmark', () => {
  it('is one outlined path with the metrics a viewBox needs', () => {
    expect(brandWordmark.path).toMatch(/^M[\d .MLQHVZ-]+Z$/);
    expect(brandWordmark.advance).toBeGreaterThan(0);
    expect(brandWordmark.baseline).toBeLessThan(brandWordmark.height);
  });
});
