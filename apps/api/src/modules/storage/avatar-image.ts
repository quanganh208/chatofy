import { createHash, randomBytes } from 'node:crypto';

/**
 * The largest avatar this API will store.
 *
 * A 128px webp — what the browser produces, and roughly what Google's `=s256-c`
 * returns — is 5–15KB in practice, so this is generous by two orders of
 * magnitude and still bounds a single request's allocation.
 *
 * It bounds BYTES, not pixels: a 2000x2000 image can compress under this. That
 * is accepted — CSS pins the rendered size, so the cost is bandwidth, and a hard
 * dimension guarantee would need a decoder in the API.
 */
export const MAX_AVATAR_BYTES = 256 * 1024;

/** An image format this API is willing to store and serve back. */
export type AvatarImageType = { mime: string; ext: string };

/**
 * Every accepted format, keyed by the bytes that identify it.
 *
 * WebP is `RIFF....WEBP` — four bytes of size sit between the two markers, so it
 * is matched in two pieces rather than as one prefix.
 */
const SIGNATURES: ReadonlyArray<{
  type: AvatarImageType;
  matches: (bytes: Buffer) => boolean;
}> = [
  {
    type: { mime: 'image/webp', ext: 'webp' },
    matches: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    type: { mime: 'image/png', ext: 'png' },
    matches: (b) =>
      b.length >= 8 &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: { mime: 'image/jpeg', ext: 'jpg' },
    matches: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
];

/**
 * Decides the type from the bytes themselves. Null means "not an image we accept".
 *
 * The client's declared content type is never consulted. These are user-supplied
 * bytes served from an origin the browser treats as ours, so a declared type is a
 * claim; pinning the stored `ContentType` from a SNIFFED value is what stops an
 * HTML payload being served back as HTML.
 *
 * The size cap is checked here too, before any signature work, so an oversized
 * payload costs nothing beyond the length read.
 */
export function sniffAvatarImage(bytes: Buffer): AvatarImageType | null {
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null;
  return SIGNATURES.find((entry) => entry.matches(bytes))?.type ?? null;
}

/**
 * `avatars/{userId}/{random16}-{hash16}.{ext}`.
 *
 * The content hash makes REPLACEMENT cache-safe: new bytes are a new URL, so a
 * cached copy of the old avatar can never be served for the new one.
 *
 * The random half is what makes the key unguessable, and the hash alone is not:
 * for a Google-imported avatar the bytes are a public artifact fetched from a
 * deterministic URL, so anyone holding the same image and the user id could
 * recompute a hash-only key. Even so, nothing in this design LEANS on
 * unguessability — the bucket is public-read by product intent.
 */
export function buildAvatarKey(
  userId: string,
  bytes: Buffer,
  type: AvatarImageType,
): string {
  const entropy = randomBytes(8).toString('hex');
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `avatars/${userId}/${entropy}-${digest}.${type.ext}`;
}
