// React Navigation's six colours, from the same palette as everything else, so the
// header and the tab bar change with the theme instead of staying platform white.

import { palettes, type ColorScheme } from '@chatofy/ui';

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
