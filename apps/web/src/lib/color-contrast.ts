/**
 * WCAG 2.x contrast, for colours a reader picks at runtime.
 *
 * The design specs carry their own copy of this arithmetic and measure the token
 * table at test time. This one exists because a custom hex is not in any table:
 * the appearance panel has to measure it in the browser, against the ground it
 * will actually be drawn on, and say so when it falls under the floor.
 */

/** Six-digit hex only. Three-digit and alpha forms are not offered by any control. */
const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && HEX.test(value);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 1 (identical) to 21 (black on white). Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `ink` laid over `ground` at `alpha` (0..1), as a solid hex.
 *
 * A translucent background is never read on its own — what reaches the eye is
 * the composite, and that is what a ratio has to be measured against.
 */
export function composite(ink: string, ground: string, alpha: number): string {
  const [a, b] = [channels(ink), channels(ground)];
  return (
    '#' +
    a
      .map((value, i) => Math.round((value * alpha + b[i]! * (1 - alpha)) * 255))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  );
}
