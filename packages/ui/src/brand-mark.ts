/**
 * The lotus mark's geometry, as data.
 *
 * Three petals on a 64-unit square: two side petals turned ±`sideAngle` about a
 * shared base, and a taller centre petal in front of them. Every surface that
 * draws the mark — the React component, the overlay's DOM-built copy, the asset
 * exporter — builds its own SVG from these numbers, because the root export is
 * data only (`root-export.spec.ts`) and the overlay cannot import React.
 *
 * The gap between the centre petal and the side petals is CUT, not painted: a
 * mask removes a `gapWidth` band along the centre petal's outline from all three
 * petals, and the centre petal then covers the side petals' overlap. A stroke in
 * the page colour would do the same on one ground and draw a visible outline on
 * every other, including a transparent raster.
 *
 * Variants, and when each is used (`docs/brand-mark.md`):
 * - `ink` — all three petals in one colour. Below 32px, and anywhere one colour
 *   is all there is. The gap is wider (`gapWidthInk`) to hold up as the mark
 *   shrinks — but see the note on `gapWidth`: widening it does not reach 16px.
 * - `dawn` — ink side petals, centre petal in the dawn gradient. 32px and up.
 * - `full` — every petal in a gradient. On a night tile and in the meeting
 *   overlay, where ink side petals would disappear.
 */
export const brandMark = {
  /** Width and height of the drawing's coordinate space. */
  viewBox: 64,
  midPath: 'M32 7 C43.5 19 44 38 32 52 C20 38 20.5 19 32 7 Z',
  sidePath: 'M32 12 C41.5 22.5 42 39 32 52 C22 39 22.5 22.5 32 12 Z',
  /** Degrees each side petal turns away from upright, about `base`. */
  sideAngle: 42,
  /** The point the three petals share. */
  base: [32, 52],
  /**
   * Width of the stroke cut from the side petals around the centre petal, in the
   * 64-unit space above — so what a reader sees is `gap / 64 × size` device px.
   *
   * Neither value reaches a whole pixel at 16: 0.75 and 0.875. The cut rounds
   * away and the three petals fuse, which the committed `icon/16.png` shows at
   * its four widest rows while 32 and 48 separate cleanly. A live renderer can
   * scale the gap by size — the overlay pill does — but a raster cannot, so the
   * 16px icon needs a re-export with a size-aware gap, or a hand-tuned one.
   */
  gapWidth: 3,
  gapWidthInk: 3.5,
  /** Ink in each scheme — the side petals of `dawn`, every petal of `ink`. */
  ink: { light: '#1C1917', dark: '#F5F5F4' },
  /** The centre petal, top to bottom — the `dawn` trio in order. */
  stops: { tip: '#F4C5A8', body: '#C8B8E0', root: '#A7E5D3' },
  /**
   * The `full` variant's side petals, each running diagonally from the base
   * outwards. Sky and rose are mark-and-illustration stops, not palette values.
   */
  sideStops: {
    left: { from: '#A7E5D3', to: '#A8C8E8' },
    right: { from: '#C8B8E0', to: '#E8B8C4' },
  },
  /** The night tile the `full` mark sits on for app and toolbar icons. */
  tile: '#0C0A09',
} as const;

export type BrandMarkVariant = 'ink' | 'dawn' | 'full';
