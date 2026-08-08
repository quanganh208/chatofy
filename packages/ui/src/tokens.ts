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

export const color = {
  /** The page itself. */
  bg: '#0C0C0E',
  /** Cards, panels, the overlay body. */
  surface: '#111113',
  /** Something sitting on a surface — a control bar, a selected row. */
  surfaceRaised: '#17171A',

  /** Separation between regions. Decorative; nothing depends on seeing it. */
  border: '#26282D',
  /** Emphasis, a hovered edge. */
  borderStrong: '#35373D',
  /**
   * The edge of anything clickable or typeable.
   *
   * Its own token because a component boundary needs 3:1 to be perceivable and
   * `border` is at 1.28. A card outline may be faint; the edge of a select may
   * not, or there is no way to tell it is a select.
   */
  borderControl: '#63666F',

  /** The translation, headings, anything that is the point. */
  text: '#EDEEF0',
  /** The source transcript, supporting prose. */
  textSecondary: '#B4B6C0',
  /** Labels, hints. Still 5.71 on `surface`, so it is safe at 11px. */
  textMuted: '#8B8D98',

  /**
   * Fills only — primary buttons, the selected segment, the level meter.
   *
   * 3.62 on `bg`: enough for a non-text component, not enough for a sentence.
   * Text that wants to be accented uses `accentText`.
   */
  accent: '#6E56CF',
  /**
   * Lighter than `accent`, but not as light as it wants to be.
   *
   * The obvious next step up the ramp put white text on it at 4.38 — a button
   * that passes at rest and fails the moment the pointer is over it, which is
   * exactly when someone is about to press it. 4.73 here.
   */
  accentHover: '#7A5FD6',
  /** Accented TEXT. Links, a speaker label. 6.68 on `bg`. */
  accentText: '#9B87F5',
  /** Background of a selected chip or a mode notice. */
  accentSubtle: '#2A2250',
  /** Text on an accent fill. 5.39 against `accent`. */
  onAccent: '#FFFFFF',

  /** Capture is running; also the stop action. As text or a dot, 4.99 on `bg`. */
  live: '#E5484D',
  /**
   * Any surface with white text on it that means "live" — the capture indicator
   * bar, and the button that stops a session.
   *
   * Darker than `live` because white on `live` is 3.91 and fails; on this it is
   * 4.93. `live` stays the colour for text and dots, where it sits ON the
   * background rather than under it. Getting these two the wrong way round makes
   * the least legible thing on the page the control someone reaches for in a
   * hurry.
   */
  liveFill: '#D13438',
  /** Background of a live-state notice. */
  liveSubtle: '#3B1219',
  /**
   * A translation is playing.
   *
   * Never distinguished from `live` by colour alone — they are red and green and
   * usually appear as a status dot. Every use carries a text label, and `live`
   * pulses while this does not.
   */
  speaking: '#30A46C',
  /** The user has something left to do: grant the microphone, reload the page. */
  warning: '#FFB224',
  /** Background of a warning notice. */
  warningSubtle: '#3B2400',
} as const;

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
