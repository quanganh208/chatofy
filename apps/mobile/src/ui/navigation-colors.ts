// React Navigation's colours and fonts, from the same tokens as everything else, so
// the header and the tab bar change with the theme and set Be Vietnam Pro instead
// of staying platform white in the system face.

import { fontWeight, palettes, type ColorScheme } from '@chatofy/ui';

export function navigationColors(scheme: ColorScheme) {
  const p = palettes[scheme];
  return {
    // The active tab and the header's back arrow: ink, like every other action.
    primary: p.accent,
    background: p.bg,
    card: p.bg,
    text: p.text,
    border: p.border,
    notification: p.live,
  };
}

/**
 * The four faces React Navigation asks for. The family is the name the expo-font
 * plugin registers on Android (app.json); weight picks the file. `fontWeight` has
 * nothing above semibold, so `bold` and `heavy` stop there too.
 */
const family = 'BeVietnamPro';
export const navigationFonts = {
  regular: { fontFamily: family, fontWeight: fontWeight.regular },
  medium: { fontFamily: family, fontWeight: fontWeight.medium },
  bold: { fontFamily: family, fontWeight: fontWeight.semibold },
  heavy: { fontFamily: family, fontWeight: fontWeight.semibold },
} as const;
