// The Tailwind theme for NativeWind, built from @chatofy/ui and nothing else.
//
// Colours are CSS variables, not values: `ThemeProvider` sets them on the root
// view from `palettes[scheme]` (see src/ui/theme-variables.ts), so one class reads
// right in both themes and no screen writes `dark:`. The names are the ones web's
// `apps/web/app/globals.css` gives the same palette keys, which is what lets a
// generated shadcn/Reusables component keep its upstream class names.
//
// Every scale below is replaced, not extended: a step that is not a token does not
// exist, so `rounded-xl` or `text-2xl` fails to style instead of drifting.
const { platformSelect } = require('nativewind/theme');
const { radius, fontSize, fontWeight, space } = require('@chatofy/ui');
const { themeVariableNames } = require('./src/ui/theme-variables.ts');

const px = (n) => `${n}px`;

// Padding, margin and gap take only the `space` steps, keyed by the Tailwind
// number that already means that size (`p-4` = 16). `p-3` or `gap-5` is not a
// step, so it styles nothing. Width and height keep the full scale: a 48px touch
// target is a size, not a spacing decision.
const tokenSpacing = {
  0: '0px',
  px: '1px',
  1: px(space.xs),
  2: px(space.sm),
  4: px(space.md),
  6: px(space.lg),
  8: px(space.xl),
  12: px(space['2xl']),
  16: px(space['3xl']),
};
const colors = Object.fromEntries(themeVariableNames.map((name) => [name, `var(--${name})`]));

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    colors: { transparent: 'transparent', ...colors },
    borderRadius: {
      none: '0px',
      sm: px(radius.sm),
      md: px(radius.md),
      lg: px(radius.lg),
      full: px(radius.full),
    },
    fontSize: Object.fromEntries(Object.entries(fontSize).map(([k, v]) => [k, px(v)])),
    fontWeight: {
      normal: fontWeight.regular,
      medium: fontWeight.medium,
      semibold: fontWeight.semibold,
    },
    fontFamily: {
      // Be Vietnam Pro, the face web reads at text sizes. Android resolves the
      // weight's file from the XML font family the expo-font plugin writes under
      // this name (app.json); iOS matches the embedded font's own family name and
      // picks the weight natively.
      sans: [
        platformSelect({ android: 'BeVietnamPro', ios: 'Be Vietnam Pro', default: 'BeVietnamPro' }),
      ],
    },
    padding: tokenSpacing,
    margin: { auto: 'auto', ...tokenSpacing },
    gap: tokenSpacing,
    space: tokenSpacing,
    extend: {},
  },
  plugins: [require('tailwindcss-animate')],
};
