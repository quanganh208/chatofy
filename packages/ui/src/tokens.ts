/**
 * The one place a brand value is authored, for web, the extension and mobile.
 *
 * TypeScript rather than CSS, and no build step, because the three consumers
 * cannot agree on a format: Tailwind needs custom properties, React Native needs
 * numbers and strings, and the meeting overlay needs a CSS *string* it can
 * interpolate into a template literal. A `.css` source could serve only the first
 * of those — Metro cannot parse it, and the extension cannot load one at all
 * (`web_accessible_resources` requires a path of exactly `/*`, which the Zoom host
 * pattern cannot satisfy). So the values live here and each consumer formats them.
 *
 * Hex, never `oklch`. React Native's colour parsing is the binding constraint and
 * Tailwind v4 takes hex without complaint, so one colour space serves everyone.
 *
 * Sizes are unitless numbers. React Native requires that; the two CSS consumers
 * append `px` where they interpolate.
 *
 * This package has no dependencies and must keep none — no React, no DOM types.
 * Metro has to be able to import it. If a component ever belongs here, it goes
 * behind a `@chatofy/ui/react` subpath so React Native never resolves DOM code.
 *
 * Every value below is justified in `docs/design-guidelines.md`, including the
 * measured contrast ratio that decided it. Change one here and change it there.
 */

/**
 * The dark palette, and the default export because three of the four surfaces read
 * it directly.
 *
 * `color` means DARK, not "the palette". The overlay imports it and must never see
 * anything else — a content script's `prefers-color-scheme` answers for the
 * operating system rather than for the meeting page it is standing on, so following
 * that setting would drop a light panel onto a dark call. Web, popup and mobile
 * choose between this and `colorLight` at runtime; the overlay does not choose.
 *
 * Adding a key here means adding it to `colorLight` too. `token-parity.spec.ts`
 * fails when the two disagree, which is the only thing keeping that honest.
 *
 * Every value is measured rather than picked: the contrast ratios and the hue
 * distances behind them are in docs/design-guidelines.md, produced by
 * plans/260820-1131-two-theme-palette/measure-palette.py.
 */
export const color = {
  bg: '#111214',
  surface: '#191B1E',
  surfaceRaised: '#212429',
  border: '#292C31',
  borderStrong: '#43484E',
  borderControl: '#696E76',
  text: '#F0F0EE',
  textSecondary: '#B4B6B2',
  textMuted: '#8A8D8A',
  accent: '#7A90F5',
  accentHover: '#93A5F8',
  accentText: '#A3B4F9',
  accentSubtle: '#1B2140',
  onAccent: '#0B1030',
  onLiveFill: '#FFFFFF',
  live: '#E9635A',
  liveFill: '#C9433A',
  liveSubtle: '#3A1B18',
  speaking: '#45B97C',
  warning: '#E9A23B',
  warningSubtle: '#3A2A0C',
} as const;

/**
 * The light palette. Same keys, different values — never a formula applied to the
 * dark ones.
 *
 * Three keys resist inversion and are set by hand. `accent` is darker here because
 * white has to sit on it; `accentText` is darker again because it is read as text
 * on a pale ground. `borderControl` is solved against `surfaceRaised` rather than
 * `surface`, since that is the ground a control actually sits on and the tighter of
 * the two.
 */
export const colorLight: Record<keyof typeof color, string> = {
  bg: '#FCFCFB',
  surface: '#FFFFFF',
  surfaceRaised: '#F4F4F1',
  border: '#E4E4E0',
  borderStrong: '#B5B5AB',
  borderControl: '#8D8D85',
  text: '#131313',
  textSecondary: '#4A4A46',
  textMuted: '#6F6F6A',
  accent: '#2F4CE0',
  accentHover: '#2439C4',
  accentText: '#2740CC',
  accentSubtle: '#ECEFFD',
  onAccent: '#FFFFFF',
  onLiveFill: '#FFFFFF',
  live: '#B3291D',
  liveFill: '#B32E23',
  liveSubtle: '#FBEAE8',
  speaking: '#0F6B3E',
  warning: '#7A4E00',
  warningSubtle: '#FBF0D8',
};

/**
 * The pair, for the surfaces that let someone choose.
 *
 * Keyed by scheme so a consumer can index with a variable rather than branch. The
 * overlay is deliberately absent from this idea entirely.
 */
export const palettes = {
  light: colorLight,
  dark: color,
} as const;

export type ColorScheme = keyof typeof palettes;

/**
 * Values only the meeting overlay uses.
 *
 * Apart from `color` because the overlay is translucent over arbitrary video and
 * permanently dark, which is true of nothing else in the product. When it is
 * illegible over a bright frame the fix is opacity here, never a lighter text
 * token — those are shared with web.
 *
 * The overlay's `z-index` and font stack are deliberately absent: both are
 * overlay-local, and an overlay that inherits the meeting page's font gains an
 * injection surface it does not need.
 */
export const overlay = {
  bg: 'rgba(17, 17, 19, 0.94)',
  border: 'rgba(255, 255, 255, 0.12)',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 9999,
} as const;

export const fontSize = {
  /** Uppercase labels. */
  xs: 11,
  /** Hints, secondary metadata. */
  sm: 12,
  /** Body, the source transcript. */
  base: 14,
  /** The translation — the largest thing on a translate surface. */
  md: 17,
  /** Section headings. */
  lg: 22,
  /** Page title. */
  xl: 28,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
} as const;

export type Color = keyof typeof color;
export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type FontSize = keyof typeof fontSize;
export type FontWeight = keyof typeof fontWeight;
