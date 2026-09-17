import { coverCrop } from './avatar-crop-geometry';

/**
 * The stored edge length, in pixels.
 *
 * `AvatarImage` renders at 32px, 40px at `size="lg"`, so 128 covers a 2× display
 * with room to spare. Resizing HERE is what keeps an image decoder out of the
 * API entirely.
 */
const AVATAR_EDGE_PX = 128;

/** Why a resize could not produce bytes — each maps to its own message. */
export type ResizeFailure = 'not-an-image' | 'decode-failed' | 'encode-failed';

export class AvatarResizeError extends Error {
  constructor(readonly reason: ResizeFailure) {
    super(reason);
    this.name = 'AvatarResizeError';
  }
}

/** Blob → raw base64, with the data-URL prefix stripped. The API refuses one. */
async function toRawBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  // Chunked: spreading a 100k-element array into `String.fromCharCode` blows the
  // argument limit on some engines.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * A user's chosen file as a square 128px image, base64-encoded for the API.
 *
 * WebP at 0.85, falling back to PNG when the browser's encoder returns null for
 * webp — the API accepts png via its sniff, so the fallback needs no server
 * change and no polyfill. A null result from BOTH is treated as a typed failure
 * rather than assumed success.
 */
export async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarResizeError('not-an-image');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // A file that claims image/* but is not decodable — a renamed extension, or
    // a format this browser has no decoder for.
    throw new AvatarResizeError('decode-failed');
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE_PX;
    canvas.height = AVATAR_EDGE_PX;
    const context = canvas.getContext('2d');
    if (!context) throw new AvatarResizeError('encode-failed');

    const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, AVATAR_EDGE_PX, AVATAR_EDGE_PX);

    const blob = (await toBlob(canvas, 'image/webp')) ?? (await toBlob(canvas, 'image/png'));
    if (!blob) throw new AvatarResizeError('encode-failed');
    return await toRawBase64(blob);
  } finally {
    bitmap.close();
  }
}

/** `canvas.toBlob` as a promise. Resolves null when the format is unsupported. */
function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}
