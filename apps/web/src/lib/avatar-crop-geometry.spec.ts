import { describe, expect, it } from 'vitest';
import { coverCrop } from './avatar-crop-geometry';

describe('coverCrop', () => {
  it('takes the whole of a square source', () => {
    expect(coverCrop(400, 400)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 400 });
  });

  it('crops the sides of a wide source, keeping full height', () => {
    expect(coverCrop(800, 400)).toEqual({ sx: 200, sy: 0, sw: 400, sh: 400 });
  });

  it('crops top and bottom of a tall source, keeping full width', () => {
    expect(coverCrop(400, 800)).toEqual({ sx: 0, sy: 200, sw: 400, sh: 400 });
  });

  it('always yields a square, so the avatar is never squashed', () => {
    for (const [w, h] of [
      [1, 1000],
      [1000, 1],
      [1023, 767],
      [17, 43],
    ]) {
      const { sw, sh } = coverCrop(w!, h!);
      expect(sw).toBe(sh);
    }
  });

  it('centres the crop, so an off-centre subject is not systematically cut', () => {
    const { sx, sw } = coverCrop(1000, 400);
    expect(sx).toBe(1000 / 2 - sw / 2);
  });
});
