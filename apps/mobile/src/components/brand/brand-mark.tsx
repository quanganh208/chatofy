/**
 * The lotus mark, drawn with react-native-svg from the geometry in
 * `@chatofy/ui`'s `brandMark` — the same data web's `BrandMark` builds from.
 *
 * The variant follows from the size, so a caller cannot break the rule in
 * docs/brand-mark.md: below 32px every petal is ink, because the dawn centre
 * petal disappears when small; from 32px the centre petal carries the dawn
 * gradient. The `full` variant belongs on a night tile, which the app does not
 * draw, so it is not offered here.
 *
 * Ink is the brand's own per-scheme value (`brandMark.ink`), which is the
 * palette's `text`, so the mark reads like the text beside it in both themes.
 *
 * The gap between petals is a mask, transparent on any ground. Its ids come from
 * `useId`: two marks mounted at once (a screen transition does that) must never
 * resolve each other's gradient or mask.
 *
 * Decorative: the name travels beside it, so it is hidden from assistive tech.
 */
import { brandMark } from '@chatofy/ui';
import { useId } from 'react';
import Svg, { Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/providers/theme-provider';

/** The edge at which the mark switches from all-ink to the dawn centre petal. */
const DAWN_FROM_PX = 32;

export function BrandMark({ size = 24 }: { size?: number }) {
  const { scheme } = useTheme();
  const id = `brand-${useId().replace(/[^\w-]/g, '')}`;
  const m = brandMark;
  const [bx, by] = m.base;
  const dawn = size >= DAWN_FROM_PX;
  const ink = m.ink[scheme];
  const gap = dawn ? m.gapWidth : m.gapWidthInk;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${m.viewBox} ${m.viewBox}`}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        {dawn ? (
          <LinearGradient id={`${id}-d`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={m.stops.tip} />
            <Stop offset="0.5" stopColor={m.stops.body} />
            <Stop offset="1" stopColor={m.stops.root} />
          </LinearGradient>
        ) : null}
        <Mask
          id={`${id}-g`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={m.viewBox}
          height={m.viewBox}
        >
          {/* Mask luminance, not colour: white keeps, black cuts the gap. */}
          <Rect width={m.viewBox} height={m.viewBox} fill="white" />
          <Path d={m.midPath} fill="none" stroke="black" strokeWidth={gap} />
        </Mask>
      </Defs>
      <G mask={`url(#${id}-g)`}>
        <Path d={m.sidePath} transform={`rotate(-${m.sideAngle} ${bx} ${by})`} fill={ink} />
        <Path d={m.sidePath} transform={`rotate(${m.sideAngle} ${bx} ${by})`} fill={ink} />
        <Path d={m.midPath} fill={dawn ? `url(#${id}-d)` : ink} />
      </G>
    </Svg>
  );
}
