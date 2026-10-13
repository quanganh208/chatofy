/**
 * Grid column count per participant count.
 *
 * 1  → 1 column (full-width)
 * 2  → 2 columns (side-by-side)
 * 3–4 → 2 columns (2×2 grid, last tile may be alone)
 * 5–6 → 3 columns (3×2 grid)
 *
 * Returns a Tailwind grid-cols-N class string.
 */
export function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}
