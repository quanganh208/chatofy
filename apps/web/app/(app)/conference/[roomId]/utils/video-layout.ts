/**
 * Google Meet-style grid layout for 1–6 participants.
 *
 * 1  → full screen (1 col)
 * 2  → side by side (2 cols)
 * 3  → one row of three (3 cols)
 * 4  → 2×2 (2 cols, 2 rows)
 * 5  → 3 top + 2 centred below  (grid-cols-6 trick: each tile spans 2 of 6
 *       sub-columns; bottom two start at sub-cols 2 and 4 so they sit centred)
 * 6  → 3×2 (3 cols, 2 rows)
 * 7+ → 3 cols (best-effort)
 */

interface TileLayout {
  /** Extra Tailwind classes applied to this specific tile's wrapper. */
  className: string;
}

export interface GridLayout {
  /** Tailwind class(es) for the grid container (grid + col definition). */
  containerClass: string;
  /** Per-tile layout descriptors, one entry per rendered tile in order. */
  tiles: TileLayout[];
}

export function computeGridLayout(count: number): GridLayout {
  if (count <= 1) {
    return {
      containerClass: 'grid grid-cols-1',
      tiles: [{ className: '' }],
    };
  }

  if (count === 2) {
    return {
      containerClass: 'grid grid-cols-2',
      tiles: [{ className: '' }, { className: '' }],
    };
  }

  if (count === 3) {
    return {
      containerClass: 'grid grid-cols-3',
      tiles: [{ className: '' }, { className: '' }, { className: '' }],
    };
  }

  if (count === 4) {
    return {
      containerClass: 'grid grid-cols-2',
      tiles: Array.from({ length: 4 }, () => ({ className: '' })),
    };
  }

  if (count === 5) {
    // grid-cols-6 sub-column trick:
    //   Row 1: T1 cols 1-2 · T2 cols 3-4 · T3 cols 5-6   (auto-placed, col-span-2)
    //   Row 2: T4 cols 2-3 · T5 cols 4-5                 (centred via explicit col-start)
    return {
      containerClass: 'grid grid-cols-6',
      tiles: [
        { className: 'col-span-2' },
        { className: 'col-span-2' },
        { className: 'col-span-2' },
        { className: 'col-span-2 col-start-2' },
        { className: 'col-span-2 col-start-4' },
      ],
    };
  }

  if (count === 6) {
    return {
      containerClass: 'grid grid-cols-3',
      tiles: Array.from({ length: 6 }, () => ({ className: '' })),
    };
  }

  // 7+ — fall back to 3-column grid, no special centering
  return {
    containerClass: 'grid grid-cols-3',
    tiles: Array.from({ length: count }, () => ({ className: '' })),
  };
}
