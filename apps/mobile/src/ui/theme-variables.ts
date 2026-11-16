// The colour variables every `className` reads, and where each one comes from.
//
// One table maps a shadcn/Reusables name to a key of the @chatofy/ui palette. It is
// the same mapping web declares by hand in `apps/web/app/globals.css`, so a
// generated component keeps its upstream class names (`bg-background`,
// `text-muted-foreground`) and still draws this project's palette. Values are
// never written here: `themeVariables(scheme)` reads them from `palettes` when the
// root view is drawn, which is why `global.css` declares nothing.
//
// `tailwind.config.js` reads the names from this module, so a variable added here
// is a utility there, and a name that is not here is not a colour at all.

import { palettes, type ColorScheme } from '@chatofy/ui';

type PaletteKey = keyof (typeof palettes)['light'];

export const themeVariableSource = {
  background: 'bg',
  foreground: 'text',
  card: 'surface',
  'card-foreground': 'text',
  popover: 'surface',
  'popover-foreground': 'text',
  muted: 'surfaceRaised',
  'muted-foreground': 'textMuted',
  secondary: 'surfaceRaised',
  'secondary-foreground': 'text',
  prose: 'textSecondary',
  primary: 'accent',
  'primary-foreground': 'onAccent',
  'accent-hover': 'accentHover',
  'accent-text': 'accentText',
  'accent-subtle': 'accentSubtle',
  destructive: 'live',
  'destructive-foreground': 'onAccent',
  live: 'live',
  'live-fill': 'liveFill',
  'on-live-fill': 'onLiveFill',
  'live-subtle': 'liveSubtle',
  speaking: 'speaking',
  warning: 'warning',
  'warning-subtle': 'warningSubtle',
  border: 'border',
  'border-strong': 'borderStrong',
  'border-control': 'borderControl',
  input: 'borderControl',
  ring: 'accent',
} as const satisfies Record<string, PaletteKey>;

export type ThemeVariableName = keyof typeof themeVariableSource;

export const themeVariableNames = Object.keys(themeVariableSource) as ThemeVariableName[];

/** `{ '--background': '#F5F5F4', … }` for one scheme — the argument to NativeWind's `vars()`. */
export function themeVariables(scheme: ColorScheme): Record<`--${ThemeVariableName}`, string> {
  const palette = palettes[scheme];
  return Object.fromEntries(
    themeVariableNames.map((name) => [`--${name}`, palette[themeVariableSource[name]]]),
  ) as Record<`--${ThemeVariableName}`, string>;
}
