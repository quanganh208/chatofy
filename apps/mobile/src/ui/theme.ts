// Every value comes from @chatofy/ui, which web and the extension also read.
// The reasoning behind each one, including the measured contrast ratios, is in
// docs/design-guidelines.md — the file the first line of this module used to
// claim it was kept in sync with, before that file existed.

import { color, fontSize, fontWeight, radius, space } from '@chatofy/ui';

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  destructive: string;
  border: string;
  text: string;
  textSecondary: string;
  muted: string;
};

/**
 * One palette, named twice.
 *
 * The product is dark on every surface, because the meeting overlay cannot be
 * anything else: inside a content script `prefers-color-scheme` reports the
 * operating system rather than the page, so a light overlay would land on top of
 * a dark call. Web followed, and so does this.
 *
 * `light` therefore carries the dark values for now. That is a decision, not an
 * oversight: `ColorScheme` and `ThemeProvider` are already wired to a two-entry
 * map, no screen exists to look wrong, and collapsing the type would be a
 * refactor of a surface nobody has built. When a light theme is designed, this is
 * where it lands.
 */
const palette: ThemeColors = {
  background: color.bg,
  surface: color.surface,
  primary: color.accent,
  primaryForeground: color.onAccent,
  // A translation is playing — the same meaning it carries on the other two
  // surfaces. Never distinguished from `destructive` by colour alone; they are
  // green and red.
  accent: color.speaking,
  destructive: color.live,
  border: color.border,
  text: color.text,
  textSecondary: color.textSecondary,
  muted: color.textMuted,
};

// Widened Record type avoids union narrowing issues when indexing with ColorScheme variable
export const colors: Record<ColorScheme, ThemeColors> = {
  light: palette,
  dark: palette,
};

/**
 * The shared scales, re-exported rather than restated.
 *
 * These replace the ones this file used to ship — radii 4/8/16 and type
 * 12/14/16/18/22/28/36 — which disagreed with the rest of the product at nearly
 * every step. They were scaffolding no screen ever read, so the shared scale won;
 * only the 64 spacing step survived, and it lives in the token module now.
 */
export const spacing = space;
export const radii = radius;
export const typography = {
  size: fontSize,
  weight: fontWeight,
} as const;
