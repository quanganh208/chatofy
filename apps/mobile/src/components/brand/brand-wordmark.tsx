/**
 * "chatofy" as the outlined Newsreader path in `@chatofy/ui`'s `brandWordmark`.
 *
 * Web sets the wordmark as live Newsreader text; the app loads only Be Vietnam
 * Pro, so it draws the outline instead — the route docs/brand-mark.md gives every
 * surface without Newsreader. `size` is the em, the same number web's font size
 * is: the path's box is one em tall (`height` = `unitsPerEm`), and its width
 * follows from the advance.
 *
 * Ink is `brandMark.ink`, the palette's `text`, so it matches the mark beside it.
 */
import { brandMark, brandWordmark } from '@chatofy/ui';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/providers/theme-provider';

export function BrandWordmark({ size = 17 }: { size?: number }) {
  const { scheme } = useTheme();
  const w = brandWordmark;
  const height = (size * w.height) / w.unitsPerEm;
  return (
    <Svg
      width={(height * w.advance) / w.height}
      height={height}
      viewBox={`0 0 ${w.advance} ${w.height}`}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={w.path} fill={brandMark.ink[scheme]} />
    </Svg>
  );
}
