/** The source rectangle to draw from, for a centre "cover" crop. */
export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The largest centred SQUARE inside a source image.
 *
 * Split out as a pure function on purpose. The canvas path around it cannot be
 * tested in this app's runner — `vitest.config.ts` sets `environment: 'node'`,
 * happy-dom has no raster backend, and there is no canvas package — so a spec
 * that asserted the produced blob's dimensions could only be asserting against
 * its own stubs. The geometry is the part that can actually be wrong (a squashed
 * or off-centre avatar), and here it is provable.
 *
 * Takes no output size: the source rectangle does not depend on one, because the
 * canvas scales whatever it is given to its own dimensions.
 */
export function coverCrop(srcW: number, srcH: number): CoverCrop {
  const edge = Math.min(srcW, srcH);
  return {
    sx: Math.round((srcW - edge) / 2),
    sy: Math.round((srcH - edge) / 2),
    sw: edge,
    sh: edge,
  };
}
