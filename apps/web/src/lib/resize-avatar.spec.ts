// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { AvatarResizeError, resizeAvatar } from './resize-avatar';

/**
 * Only the failure branches, and only the ones a DOM-less runner can actually
 * reach. `vitest.config.ts` sets `environment: 'node'` and happy-dom has no
 * raster backend, so the encode path cannot be exercised here — the geometry it
 * would produce is proved by `avatar-crop-geometry.spec.ts` instead, which is
 * why that function is pure.
 *
 * What IS reachable is the classification: each failure has to name itself
 * correctly, because the account card maps those names to four different
 * messages and picking the wrong one sends the user to the wrong next step.
 */
describe('resizeAvatar failure classification', () => {
  const fileOfType = (type: string) => new File(['x'], 'a', { type });

  it('rejects a non-image before touching a decoder', async () => {
    const err = await resizeAvatar(fileOfType('application/pdf')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvatarResizeError);
    expect((err as AvatarResizeError).reason).toBe('not-an-image');
  });

  it('reports a decode failure for a file that claims an image type', async () => {
    // A renamed extension, or a format this browser has no decoder for. Here it
    // is happy-dom having no `createImageBitmap` at all, which exercises the
    // same catch.
    const err = await resizeAvatar(fileOfType('image/png')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvatarResizeError);
    expect((err as AvatarResizeError).reason).toBe('decode-failed');
  });

  it('reports an encode failure when the canvas yields no 2d context', async () => {
    // Distinct from decode-failed on purpose: the file was fine and the browser
    // could not produce bytes, so "choose another image" would be wrong advice.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 400, height: 400, close: vi.fn() })),
    );
    const err = await resizeAvatar(fileOfType('image/png')).catch((e: unknown) => e);
    vi.unstubAllGlobals();

    expect(err).toBeInstanceOf(AvatarResizeError);
    expect((err as AvatarResizeError).reason).toBe('encode-failed');
  });
});
