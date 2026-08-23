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
 * distances behind them are in docs/design-guidelines.md, and
 * apps/web/src/design/contrast-floors.spec.ts fails when one slips. That spec
 * reads the palettes below rather than restating them, so a hex changed here is
 * measured here — the script it replaces carried its own copy and could only ever
 * check what it had last been told.
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
 * `surface`, since that is the tighter of the two grounds it is used on.
 *
 * That reasoning used to end "since that is the ground a control actually sits
 * on", which is no longer true of controls generally: under direction C1 the
 * default control language is a depth pair and nothing draws this token by
 * default. It is kept, and still solved the same way, for the cases that do — a
 * notice's action, a checkbox or radio whose shape is its edge, an invalid
 * field. `docs/design-guidelines.md` carries the decision and its cost.
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

/**
 * Depth, as two halves per step — and the two halves are not the same shape.
 *
 * Light carries elevation in shadow. Dark cannot: a black shadow on `bg` (#111214)
 * is very nearly invisible, so depth there comes from the luminance steps this
 * palette already owns — `bg` → `surface` → `surfaceRaised` — with the shadow
 * reduced to an anchor and a one-pixel top highlight standing in for the light
 * that a raised surface would catch. That asymmetry is the whole reason these are
 * strings per theme rather than one value with a swapped colour.
 *
 * **Nothing here introduces a palette value**, which is what keeps the measured
 * contrast floors untouched by a change that alters how every surface reads.
 *
 * Two consumers, two formats, and they are not interchangeable:
 *
 * - Web and the popup compose BOTH halves into one declaration, each layer's
 *   colour wrapped in `light-dark()` and collapsed to `transparent` in the theme
 *   that does not own it. They cannot do anything else: `:root.light`/`:root.dark`
 *   move `color-scheme` and nothing more, so there is no per-theme block to put a
 *   second value in.
 *
 *   `light-dark()` must wrap the COLOUR of each layer, never the whole list — it
 *   is a `<color>` function, so `box-shadow: light-dark(<list>, <list>)` is invalid
 *   at computed value time and resolves to `none` in both themes. Measured in
 *   Chromium: the layer form paints in both, the wrapping form paints in neither,
 *   and Tailwind compiles both without complaint. A regex parity test cannot see
 *   the difference either, so this comment is most of what stands between the two.
 *
 * - The overlay interpolates `dark` DIRECTLY. It is permanently dark and a
 *   `light-dark()` in its sheet would make it follow the operating system — the
 *   white-slab-on-a-dark-call failure the rest of this module is arranged to avoid.
 */
export const elevation = {
  /** A control, a selected segment — something lifted just off its track. */
  sm: {
    light: '0 1px 2px rgba(19, 19, 19, 0.055), 0 1px 1px rgba(19, 19, 19, 0.04)',
    dark: '0 1px 2px rgba(0, 0, 0, 0.35)',
  },
  /** A card or panel: the default resting height of a surface. */
  md: {
    light: '0 2px 4px rgba(19, 19, 19, 0.05), 0 6px 16px rgba(19, 19, 19, 0.075)',
    dark: '0 4px 14px rgba(0, 0, 0, 0.42)',
  },
  /** Something over the page — a dropdown, the overlay's own panel. */
  lg: {
    light: '0 4px 8px rgba(19, 19, 19, 0.05), 0 14px 34px rgba(19, 19, 19, 0.1)',
    dark: '0 10px 30px rgba(0, 0, 0, 0.5)',
  },
} as const;

/**
 * The top highlight that carries dark's elevation, and the hairline that survives
 * on a surface once a shadow is doing the separating.
 *
 * Separate from `elevation` because they are applied differently — the highlight is
 * an inset layer appended to a shadow list, the hairline is a border colour — and
 * because only some elevated things want the highlight. Not palette values: they
 * are translucent white and translucent ink, so they resolve against whatever they
 * are laid over and never enter the contrast table.
 */
export const surfaceEdge = {
  /** Appended to a card's shadow list on dark. Light gets nothing: it has shadow. */
  highlight: { light: 'transparent', dark: 'rgba(255, 255, 255, 0.045)' },
  /**
   * The border on a surface that is now separated by shadow instead. This is the
   * `border` hairline receding — measured 1.34:1 against `bg`, a hairline and not a
   * boundary, so 1.4.11 does not reach it.
   *
   * It is ALSO the edge of the C1 quiet button, drawn there as an inset shadow
   * layer rather than a border. That is a control, so the consequence is worth
   * stating plainly rather than leaving to be discovered: on that one use it
   * carries a boundary at a ratio no boundary should be carried at. Deliberate,
   * measured, and recorded in `docs/design-guidelines.md`; `insetField` is the
   * same trade on a field.
   *
   * `borderControl` is a different token and a real boundary at 3.03:1. It must
   * not be replaced by this one anywhere a boundary has to be found without
   * hovering.
   */
  hairline: { light: 'rgba(19, 19, 19, 0.06)', dark: 'rgba(255, 255, 255, 0.055)' },
} as const;

/**
 * The recess a text field is cut into its surface with.
 *
 * Shaped like an `elevation` step — a shadow list per theme — and deliberately
 * NOT a member of `surfaceEdge`, which holds single colours the parity spec
 * compares with `halves()`. It sits here rather than in `elevation` because it is
 * the opposite gesture: every layer is `inset`, and a field must never lift.
 *
 * That opposition is the whole control language. A field is a well cut into the
 * surface; a button is an object sitting on it. Fill cannot carry the difference —
 * `card` and `secondary` are 1.10:1 apart — so the direction of depth does.
 *
 * Two layers. The second is the edge, and it is what replaced the control border:
 * `docs/design-guidelines.md` records that it composites to 1.13:1 light and
 * 1.17:1 dark, under WCAG 1.4.11's 3:1, and that the trade-off was accepted
 * knowingly against a measured alternative. The first is the recess itself.
 *
 * Not palette values, for the same reason `surfaceEdge` is not: translucent ink
 * and translucent white, resolving against whatever they are laid over, so they
 * never enter the contrast table.
 *
 * Unlike an elevation step, NOTHING here collapses to `transparent` — both themes
 * paint both layers, and dark carries a heavier recess because a shadow on
 * `#111214` has less room to work in.
 */
export const insetField = {
  light: 'inset 0 1px 2px rgba(19, 19, 19, 0.07), inset 0 0 0 1px rgba(19, 19, 19, 0.045)',
  dark: 'inset 0 1px 2px rgba(0, 0, 0, 0.38), inset 0 0 0 1px rgba(255, 255, 255, 0.045)',
} as const;

/**
 * How long a thing takes, and the curve it takes it on.
 *
 * Before this there was no scale at all: everything animated ran on Tailwind's
 * default 150ms because no call site had anything else to ask for, so nothing was
 * in step with anything.
 *
 * `duration` is unitless, like every other size in this module — React Native needs
 * numbers, and the CSS consumers append `ms` exactly where they already append
 * `px`. `easing` is a CSS string that React Native ignores, which is the same
 * asymmetry `fontWeight` already carries.
 *
 * A trap worth knowing before wiring these into Tailwind: `--ease-*` is a theme
 * namespace and mints `ease-standard`; **`--duration-*` is not one**, and declaring
 * it in `@theme` mints nothing — no error, no utility. Measured against the
 * installed Tailwind, not assumed. The surfaces define role-named `@utility` rules
 * over these instead.
 */
export const motion = {
  duration: {
    /** Hover, focus, press — a response, not an animation. */
    fast: 120,
    /** A notice arriving, a control changing state, the segmented thumb travelling. */
    base: 200,
    /** A status colour crossfading, a settled transcript line entering. */
    slow: 320,
  },
  easing: {
    /** The default: leaves quickly, arrives gently. */
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    /** Entering — decelerating into place. */
    enter: 'cubic-bezier(0, 0, 0, 1)',
    /** Leaving — no lingering. */
    exit: 'cubic-bezier(0.3, 0, 1, 1)',
  },
} as const;

export type Color = keyof typeof color;
export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type FontSize = keyof typeof fontSize;
export type FontWeight = keyof typeof fontWeight;
export type Elevation = keyof typeof elevation;
export type SurfaceEdge = keyof typeof surfaceEdge;
export type Duration = keyof typeof motion.duration;
export type Easing = keyof typeof motion.easing;
