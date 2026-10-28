/**
 * How the transcript LOOKS to one reader: colours, face, spacing, weight,
 * alignment and whether turns carry a time.
 *
 * Two of these live in the translate settings — one for the page, one for the
 * stage (fullscreen and the floating caption window) — and both are applied the
 * same way: as custom properties written on the one element that already carries
 * `--reading-scale`, read by the utilities in `app/globals.css`. Every utility
 * falls back to the look the transcript had before any of this existed, so the
 * default appearance writes NOTHING, and `/history` — which renders the same
 * transcript and never writes these — cannot change.
 *
 * ## A colour is a choice, not a hex
 *
 * `'default'`, a preset name, or a six-digit hex. Presets are pairs, one value per
 * theme, written as `light-dark()` so a theme switch needs no JavaScript;
 * `reading-appearance.spec.ts` holds every ink at 4.5:1 on the surface and on
 * every ground preset of its scheme. A hex is the reader's own and is not held by
 * anything: the panel measures it and warns, and never refuses.
 *
 * ## A ground decides its own scheme
 *
 * A black background under the light theme's ink is unreadable, and every token
 * in the app is a `light-dark()` pair resolved against `color-scheme`. So a ground
 * that is the same in both themes — black, navy, white, or a custom hex — sets
 * the scheme of the subtree it paints (`readingSchemeClass`), from its own luminance, and every
 * default ink inside it flips with it. An adaptive ground (a pair) leaves the
 * scheme alone, because it already follows it.
 */
import type { CSSProperties } from 'react';
import { z } from 'zod';
import type { ColorScheme } from '@chatofy/ui';
import { composite, contrastRatio, isHexColor, luminance } from '@/lib/color-contrast';

/** The floor every preset is held to and every custom colour is measured against. */
export const READABLE_CONTRAST = 4.5;

type Pair = { readonly light: string; readonly dark: string };

/**
 * Text colours. Each pair is solved against `surface` and against every ground
 * below that shares its scheme — see the spec.
 */
export const INK_PRESETS = {
  muted: { light: '#57534E', dark: '#C4BFBA' },
  amber: { light: '#8A4B00', dark: '#F2B54B' },
  yellow: { light: '#6E5600', dark: '#FFE066' },
  rose: { light: '#B4234A', dark: '#F59AB0' },
  violet: { light: '#6B3FC2', dark: '#C3A6F7' },
  sky: { light: '#0B5FA0', dark: '#7CC4F5' },
  emerald: { light: '#0F6B3E', dark: '#6FD39E' },
} as const satisfies Record<string, Pair>;

/**
 * Backgrounds. The first three adapt to the theme; the last three are one colour
 * in both and therefore carry a scheme of their own.
 */
export const GROUND_PRESETS = {
  cream: { light: '#FBF6EA', dark: '#221D16' },
  mist: { light: '#EEF3F8', dark: '#151B22' },
  sage: { light: '#EEF5EF', dark: '#141C17' },
  black: { light: '#000000', dark: '#000000' },
  navy: { light: '#0B1B33', dark: '#0B1B33' },
  white: { light: '#FFFFFF', dark: '#FFFFFF' },
} as const satisfies Record<string, Pair>;

export type InkPreset = keyof typeof INK_PRESETS;
export type GroundPreset = keyof typeof GROUND_PRESETS;
export type HexColor = `#${string}`;
export type InkChoice = 'default' | InkPreset | HexColor;
export type GroundChoice = 'default' | GroundPreset | HexColor;

export const READING_FONTS = ['sans', 'serif', 'mono', 'legible'] as const;
export const READING_LEADINGS = ['compact', 'normal', 'relaxed'] as const;
export const READING_WEIGHTS = ['regular', 'medium', 'semibold', 'bold'] as const;
export const READING_ALIGNS = ['start', 'center'] as const;
/** The background opacity slider's stops, in percent. */
export const OPACITY_STEP = 5;

export type ReadingFont = (typeof READING_FONTS)[number];
export type ReadingLeading = (typeof READING_LEADINGS)[number];
export type ReadingWeight = (typeof READING_WEIGHTS)[number];
export type ReadingAlign = (typeof READING_ALIGNS)[number];

/** The four ink slots, in the order the panel lists them. */
export const INK_SLOTS = ['targetColor', 'sourceColor', 'speakerColor', 'timeColor'] as const;
export type InkSlot = (typeof INK_SLOTS)[number];

export interface ReadingAppearance {
  sourceColor: InkChoice;
  targetColor: InkChoice;
  timeColor: InkChoice;
  speakerColor: InkChoice;
  background: GroundChoice;
  /** 0..100 in {@link OPACITY_STEP}s. Only read when there is a background. */
  backgroundOpacity: number;
  font: ReadingFont;
  lineHeight: ReadingLeading;
  /** The translation line's weight. `medium` is what it has always been. */
  targetWeight: ReadingWeight;
  align: ReadingAlign;
  showTime: boolean;
}

/**
 * Exactly the appearance fields of something that carries more — the stage
 * profile adds its own text size and `followPage`, which no consumer of an
 * appearance should see.
 */
export function pickReadingAppearance(value: ReadingAppearance): ReadingAppearance {
  return {
    sourceColor: value.sourceColor,
    targetColor: value.targetColor,
    timeColor: value.timeColor,
    speakerColor: value.speakerColor,
    background: value.background,
    backgroundOpacity: value.backgroundOpacity,
    font: value.font,
    lineHeight: value.lineHeight,
    targetWeight: value.targetWeight,
    align: value.align,
    showTime: value.showTime,
  };
}

/** The page's appearance before anybody changes it: exactly the old transcript. */
export const DEFAULT_READING_APPEARANCE: ReadingAppearance = Object.freeze({
  sourceColor: 'default',
  targetColor: 'default',
  timeColor: 'default',
  speakerColor: 'default',
  background: 'default',
  backgroundOpacity: 100,
  font: 'sans',
  lineHeight: 'normal',
  targetWeight: 'medium',
  align: 'start',
  showTime: true,
});

const FONT_STACK: Record<Exclude<ReadingFont, 'sans'>, string> = {
  serif: 'var(--font-newsreader), Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  legible: 'var(--font-legible), var(--font-sans)',
};

const LEADING: Record<ReadingLeading, number> = { compact: 0.9, normal: 1, relaxed: 1.2 };
const WEIGHT: Record<ReadingWeight, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const isInkPreset = (value: string): value is InkPreset => Object.hasOwn(INK_PRESETS, value);
const isGroundPreset = (value: string): value is GroundPreset =>
  Object.hasOwn(GROUND_PRESETS, value);

/** A pair as one CSS value that follows `color-scheme`. */
function pairValue(pair: Pair): string {
  return pair.light === pair.dark ? pair.light : `light-dark(${pair.light}, ${pair.dark})`;
}

function inkValue(choice: InkChoice): string | null {
  if (choice === 'default') return null;
  if (isInkPreset(choice)) return pairValue(INK_PRESETS[choice]);
  return choice;
}

/** A ground's colour in one scheme, or null for "the page's own". */
function groundHex(choice: GroundChoice, scheme: ColorScheme): string | null {
  if (choice === 'default') return null;
  if (isGroundPreset(choice)) return GROUND_PRESETS[choice][scheme];
  return choice;
}

/**
 * Below this opacity a ground is mostly the page showing through, and forcing
 * its scheme would put light ink on what is drawn as a light grey. At 60% black
 * over the light page the composite is dark enough for the dark set; at 50% it
 * suits neither, and the ink warnings say so.
 */
const FORCED_SCHEME_OPACITY = 60;

/**
 * The scheme a ground forces on what it paints, or null when it follows the
 * theme. Decided by luminance so a custom hex gets the same treatment as a preset:
 * a dark colour under light-theme ink would otherwise be the default state. Only
 * while the ground is mostly opaque — see {@link FORCED_SCHEME_OPACITY}.
 */
export function groundScheme(choice: GroundChoice, opacity = 100): ColorScheme | null {
  if (choice === 'default' || opacity < FORCED_SCHEME_OPACITY) return null;
  const pair = isGroundPreset(choice) ? GROUND_PRESETS[choice] : { light: choice, dark: choice };
  if (pair.light !== pair.dark) return null;
  return luminance(pair.light) < 0.18 ? 'dark' : 'light';
}

/**
 * The custom properties for one appearance. The default appearance yields `{}`:
 * every utility's fallback IS the default, so writing it would only add a second
 * place where the old look is spelled.
 */
export function appearanceVars(appearance: ReadingAppearance): Record<string, string> {
  const vars: Record<string, string> = {};
  const inks: Record<InkSlot, string> = {
    sourceColor: '--reading-source',
    targetColor: '--reading-target',
    timeColor: '--reading-time',
    speakerColor: '--reading-speaker',
  };
  for (const slot of INK_SLOTS) {
    const value = inkValue(appearance[slot]);
    if (value) vars[inks[slot]] = value;
  }

  const { background, backgroundOpacity } = appearance;
  if (background !== 'default') {
    const solid = isGroundPreset(background) ? pairValue(GROUND_PRESETS[background]) : background;
    vars['--reading-bg'] =
      backgroundOpacity >= 100
        ? solid
        : `color-mix(in srgb, ${solid} ${backgroundOpacity}%, transparent)`;
  }

  if (appearance.font !== 'sans') vars['--reading-font'] = FONT_STACK[appearance.font];
  if (appearance.lineHeight !== 'normal') {
    vars['--reading-leading'] = String(LEADING[appearance.lineHeight]);
  }
  if (appearance.targetWeight !== 'medium') {
    vars['--reading-target-weight'] = String(WEIGHT[appearance.targetWeight]);
  }
  if (appearance.align !== 'start') vars['--reading-align'] = appearance.align;
  return vars;
}

/**
 * The class that flips the tokens under a ground that forces a scheme, or
 * nothing. A class, not an inline `color-scheme`: the tokens only re-resolve where
 * they are re-declared, and `app/globals.css` re-declares them on these two.
 */
export function readingSchemeClass(appearance: ReadingAppearance): string | undefined {
  const scheme = groundScheme(appearance.background, appearance.backgroundOpacity);
  return scheme ? `reading-scheme-${scheme}` : undefined;
}

/**
 * The style for the one element that carries a transcript's look: its reading
 * scale and its appearance together, so a second writer of either cannot appear.
 */
export function readingStyle(appearance: ReadingAppearance, scale: number): CSSProperties {
  return { '--reading-scale': scale, ...appearanceVars(appearance) } as CSSProperties;
}

/**
 * What each ink resolves to when nobody picked one — the tokens the transcript
 * draws them with, per scheme. Mirrors `app/globals.css`; the spec checks the
 * two against `@chatofy/ui`'s palettes.
 */
const DEFAULT_INK: Record<InkSlot, Pair> = {
  sourceColor: { light: '#57534E', dark: '#C4BFBA' },
  targetColor: { light: '#1C1917', dark: '#F5F5F4' },
  speakerColor: { light: '#6B6560', dark: '#A8A29E' },
  timeColor: { light: '#6B6560', dark: '#A8A29E' },
};
/** The page ground under the transcript, which a translucent background mixes with. */
const PAGE_GROUND: Pair = { light: '#F5F5F4', dark: '#0C0A09' };

export interface InkContrast {
  /** Against the ground as drawn in the scheme on screen now. */
  ratio: number;
  /**
   * Under the floor in the theme NOT on screen. A custom hex applies in both,
   * and a colour picked in light that vanishes in dark is a surprise for later.
   */
  failsInOtherScheme: boolean;
}

function measure(appearance: ReadingAppearance, slot: InkSlot, pageScheme: ColorScheme): number {
  const scheme = groundScheme(appearance.background, appearance.backgroundOpacity) ?? pageScheme;
  const page = PAGE_GROUND[pageScheme];
  const ground = groundHex(appearance.background, scheme);
  const drawn = ground ? composite(ground, page, appearance.backgroundOpacity / 100) : page;
  const choice = appearance[slot];
  const ink =
    choice === 'default'
      ? DEFAULT_INK[slot][scheme]
      : isInkPreset(choice)
        ? INK_PRESETS[choice][scheme]
        : choice;
  return contrastRatio(ink, drawn);
}

/** How readable one ink is on this appearance's ground. */
export function inkContrast(
  appearance: ReadingAppearance,
  slot: InkSlot,
  pageScheme: ColorScheme,
): InkContrast {
  const other: ColorScheme = pageScheme === 'light' ? 'dark' : 'light';
  return {
    ratio: measure(appearance, slot, pageScheme),
    failsInOtherScheme: measure(appearance, slot, other) < READABLE_CONTRAST,
  };
}

/**
 * The stored shape, one `catch` per field for the reason the settings whitelist
 * gives: one unreadable value must not reset the rest. Built from a defaults
 * object so the page and the stage — which start from different looks — share
 * one declaration.
 */
export function readingAppearanceShape(defaults: ReadingAppearance) {
  const ink = (fallback: InkChoice) =>
    z
      .string()
      .refine((value) => value === 'default' || isInkPreset(value) || isHexColor(value))
      .transform((value) => (isHexColor(value) ? value.toLowerCase() : value) as InkChoice)
      .catch(fallback);
  const ground = z
    .string()
    .refine((value) => value === 'default' || isGroundPreset(value) || isHexColor(value))
    .transform((value) => (isHexColor(value) ? value.toLowerCase() : value) as GroundChoice)
    .catch(defaults.background);

  return {
    sourceColor: ink(defaults.sourceColor),
    targetColor: ink(defaults.targetColor),
    timeColor: ink(defaults.timeColor),
    speakerColor: ink(defaults.speakerColor),
    background: ground,
    backgroundOpacity: z
      .number()
      .catch(defaults.backgroundOpacity)
      .transform(
        (value) => Math.round(Math.min(100, Math.max(0, value)) / OPACITY_STEP) * OPACITY_STEP,
      ),
    font: z.enum(READING_FONTS).catch(defaults.font),
    lineHeight: z.enum(READING_LEADINGS).catch(defaults.lineHeight),
    targetWeight: z.enum(READING_WEIGHTS).catch(defaults.targetWeight),
    align: z.enum(READING_ALIGNS).catch(defaults.align),
    showTime: z.boolean().catch(defaults.showTime),
  };
}
