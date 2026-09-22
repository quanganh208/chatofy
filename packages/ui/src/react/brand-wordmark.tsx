import * as React from 'react';

import { brandWordmark } from '../brand-wordmark.js';
import { cn } from '../lib/utils.js';

/**
 * "chatofy" as an outlined path, for a surface that carries no Newsreader.
 *
 * The extension popup ships Be Vietnam Pro only, and a second family there would
 * mean a second pinned subset pipeline for seven letters. Web does NOT use this:
 * it sets the wordmark as live Newsreader text, so it selects, scales with the
 * reader's zoom, and hints at small sizes.
 *
 * `height` is the height of the drawing's box (ascender to descender); the width
 * follows the font's own advance. Filled with `currentColor`, so it is ink in
 * whatever scheme the text around it is.
 */
function BrandWordmark({
  height = 20,
  className,
  ...props
}: Omit<React.ComponentProps<'svg'>, 'children' | 'role'> & { height?: number }) {
  const w = brandWordmark;
  return (
    <svg
      data-slot="brand-wordmark"
      role="img"
      aria-label="Chatofy"
      height={height}
      width={(w.advance / w.height) * height}
      viewBox={`0 0 ${w.advance} ${w.height}`}
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d={w.path} fill="currentColor" />
    </svg>
  );
}

export { BrandWordmark };
