import * as React from 'react';

import { brandMark, type BrandMarkVariant } from '../brand-mark.js';
import { cn } from '../lib/utils.js';

/**
 * The lotus mark, built from the geometry in `brand-mark.ts`.
 *
 * Which variant a placement uses is the size rule, and the caller decides it:
 * `ink` below 32px, `dawn` from 32px, `full` on a night tile. Ink is
 * `currentColor`, so the mark follows the text colour it stands beside and flips
 * with the theme without a token of its own.
 *
 * The gap between the petals is a mask, so it is transparent on any ground. Its
 * ids come from `useId`: two marks on one page — the header and a footer, say —
 * must never resolve each other's gradient or mask, which is what a fixed id
 * does the moment the first one unmounts.
 *
 * Decorative: the name always travels beside it as text or as the wordmark's
 * label, so the mark itself is `aria-hidden`. It does not animate.
 */
function BrandMark({
  variant = 'ink',
  size = 20,
  className,
  ...props
}: Omit<React.ComponentProps<'svg'>, 'children'> & {
  variant?: BrandMarkVariant;
  size?: number;
}) {
  const id = `brand-${React.useId().replace(/[^\w-]/g, '')}`;
  const m = brandMark;
  const [bx, by] = m.base;
  const gap = variant === 'ink' ? m.gapWidthInk : m.gapWidth;
  const sideFills =
    variant === 'full' ? [`url(#${id}-l)`, `url(#${id}-r)`] : ['currentColor', 'currentColor'];
  const midFill = variant === 'ink' ? 'currentColor' : `url(#${id}-d)`;

  return (
    <svg
      data-slot="brand-mark"
      data-variant={variant}
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${m.viewBox} ${m.viewBox}`}
      className={cn('shrink-0', className)}
      {...props}
    >
      <defs>
        {variant !== 'ink' && (
          <linearGradient id={`${id}-d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={m.stops.tip} />
            <stop offset=".5" stopColor={m.stops.body} />
            <stop offset="1" stopColor={m.stops.root} />
          </linearGradient>
        )}
        {variant === 'full' && (
          <>
            <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={m.sideStops.left.from} />
              <stop offset="1" stopColor={m.sideStops.left.to} />
            </linearGradient>
            <linearGradient id={`${id}-r`} x1="1" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={m.sideStops.right.from} />
              <stop offset="1" stopColor={m.sideStops.right.to} />
            </linearGradient>
          </>
        )}
        <mask
          id={`${id}-g`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={m.viewBox}
          height={m.viewBox}
        >
          <rect width={m.viewBox} height={m.viewBox} fill="#fff" />
          <path d={m.midPath} fill="none" stroke="#000" strokeWidth={gap} />
        </mask>
      </defs>
      <g mask={`url(#${id}-g)`}>
        <path
          d={m.sidePath}
          transform={`rotate(-${m.sideAngle} ${bx} ${by})`}
          fill={sideFills[0]}
        />
        <path d={m.sidePath} transform={`rotate(${m.sideAngle} ${bx} ${by})`} fill={sideFills[1]} />
        <path d={m.midPath} fill={midFill} />
      </g>
    </svg>
  );
}

export { BrandMark };
