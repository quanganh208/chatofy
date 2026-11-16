// Depth for the className world, read from @chatofy/ui so it changes with the theme.
//
// NativeWind's `shadow-*` utilities write the old iOS shadow props, which cannot
// carry the per-theme layer lists `elevation` and `insetField` are. React Native's
// `boxShadow` style can (inset layers included), so depth goes through a style
// rather than a class. The light and dark halves are different shapes on purpose —
// see `elevation` in packages/ui/src/tokens.ts.

import type { ViewStyle } from 'react-native';
import { elevation, insetField, type Elevation } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

/** `{ boxShadow }` for an object lifted off the surface: a control at `sm`, a sheet at `lg`. */
export function useElevation(step: Elevation): ViewStyle {
  const { scheme } = useTheme();
  return { boxShadow: elevation[step][scheme] };
}

/** `{ boxShadow }` for a text field: a well cut into the surface, never lifted. */
export function useFieldRecess(): ViewStyle {
  const { scheme } = useTheme();
  return { boxShadow: insetField[scheme] };
}
