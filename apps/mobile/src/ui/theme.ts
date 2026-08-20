// Every value comes from @chatofy/ui, which web and the extension also read.
// The reasoning behind each one, including the measured contrast ratios, is in
// docs/design-guidelines.md — the file the first line of this module used to
// claim it was kept in sync with, before that file existed.

import { fontSize, fontWeight, palettes, radius, space, type ColorScheme } from '@chatofy/ui';

// Re-exported rather than redeclared: the token module owns the pair, and two
// definitions of the same union is how one of them gains a third member alone.
export type { ColorScheme };

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
 * Two palettes, one shape.
 *
 * Both halves are real now. The overlay is still permanently dark, and its reason
 * has not changed — inside a content script `prefers-color-scheme` answers for the
 * operating system rather than for the meeting page, so following it would drop a
 * light panel onto a dark call. What changed is that this only ever constrained the
 * overlay: web, the popup and these screens let someone choose.
 *
 * Values, and the contrast measured for each pair, live in
 * docs/design-guidelines.md.
 */
const from = (scheme: ColorScheme): ThemeColors => ({
  background: palettes[scheme].bg,
  surface: palettes[scheme].surface,
  primary: palettes[scheme].accent,
  primaryForeground: palettes[scheme].onAccent,
  // A translation is playing — the same meaning it carries on the other two
  // surfaces. Never distinguished from `destructive` by colour alone; they are
  // green and red.
  accent: palettes[scheme].speaking,
  destructive: palettes[scheme].live,
  border: palettes[scheme].border,
  text: palettes[scheme].text,
  textSecondary: palettes[scheme].textSecondary,
  muted: palettes[scheme].textMuted,
});

export const colors: Record<ColorScheme, ThemeColors> = {
  light: from('light'),
  dark: from('dark'),
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
