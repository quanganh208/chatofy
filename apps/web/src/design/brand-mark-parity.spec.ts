import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brandMark } from '@chatofy/ui';
import { describe, expect, it } from 'vitest';

/**
 * The copies of the lotus that a renderer cannot keep honest.
 *
 * `brand-mark.ts` is the geometry, and three of the four builders read it: the React
 * component, the overlay's `createElementNS` copy, and the out-of-tree exporter. The
 * fourth is `apps/web/app/icon.svg`, which inlines every number as a literal because
 * a favicon is fetched by the browser as a file and no code path in this repo ever
 * imports it. Nothing else here reads it either — so reshaping `midPath` moves the
 * web mark and the overlay mark, leaves the favicon drawing the previous lotus, and
 * the whole suite stays green.
 *
 * That is the same shape of hole `token-parity.spec.ts` exists for, and it is checked
 * the same way: read the file that lives outside the import graph and hold it to the
 * module. Source-level, because the failure is that two files disagree — a rendered
 * ratio or a mounted DOM cannot see it.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const FAVICON = '../../app/icon.svg';
const OVERLAY = '../../../extension/entrypoints/content/overlay.ts';

describe('the favicon carries the mark it is a copy of', () => {
  const svg = read(FAVICON);

  it.each([
    ['the centre petal', () => brandMark.midPath],
    ['the side petal', () => brandMark.sidePath],
  ])('draws %s from the geometry', (_what, path) => {
    expect(svg).toContain(path());
  });

  it('turns the side petals by sideAngle about the shared base', () => {
    const [bx, by] = brandMark.base;
    expect(svg).toContain(`rotate(-${brandMark.sideAngle} ${bx} ${by})`);
    expect(svg).toContain(`rotate(${brandMark.sideAngle} ${bx} ${by})`);
  });

  /**
   * The favicon is the `ink` variant, so it takes the wider cut — the one place in
   * the repo where the distinction between the two gap widths is written as a
   * number rather than chosen by a branch.
   */
  it('cuts the gap at the ink width', () => {
    expect(svg).toContain(`stroke-width="${brandMark.gapWidthInk}"`);
  });

  it('paints ink in both schemes', () => {
    expect(svg).toContain(brandMark.ink.light);
    expect(svg).toContain(brandMark.ink.dark);
  });

  /**
   * A mask cut, not a painted stroke — the property that lets the mark sit on any
   * ground, including the transparent one a favicon is composited onto.
   */
  it('cuts the gap rather than painting it', () => {
    expect(svg).toMatch(/<mask id="[^"]+"[^>]*maskUnits="userSpaceOnUse"/);
    expect(svg).toMatch(/stroke="#000"/);
  });

  /**
   * The favicon is the `ink` variant: one colour, no gradient.
   *
   * It was cut from the `full` template and arrived carrying that template's three
   * `linearGradient` defs, every one of them unreferenced — bytes on each fetch, and
   * a reader's first impression that the favicon is the dawn mark. Asserted as an
   * absence rather than by walking the declarations, because a walk over nothing
   * passes without checking anything.
   */
  it('declares no gradient, being the ink variant', () => {
    expect(svg).not.toMatch(/<linearGradient/);
    expect(svg).not.toMatch(/url\(#[^)]*-(d|l|r)\)/);
  });
});

describe('the overlay builds the mark rather than restating it', () => {
  const source = read(OVERLAY);

  /**
   * The overlay's copy is DOM calls rather than markup, so it cannot be compared to
   * the favicon literally. What it can be held to is deriving every number from the
   * module: a hardcoded path here is the same stale-copy failure, one indirection
   * further away.
   */
  it.each([
    ['the centre petal', () => brandMark.midPath],
    ['the side petal', () => brandMark.sidePath],
  ])('never inlines %s', (_what, path) => {
    expect(source).not.toContain(path());
  });

  it.each(['midPath', 'sidePath', 'viewBox', 'base', 'sideAngle'])(
    'reads %s from the geometry',
    (key) => {
      expect(source).toMatch(new RegExp(`\\bm\\.${key}\\b`));
    },
  );
});
