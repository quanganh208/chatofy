import {
  MAX_AVATAR_BYTES,
  buildAvatarKey,
  sniffAvatarImage,
} from './avatar-image';

/** A minimal payload carrying each format's real signature bytes. */
const webp = (tail = 'a') =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from(tail, 'ascii'),
  ]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

describe('sniffAvatarImage', () => {
  it('identifies each accepted format from its bytes', () => {
    expect(sniffAvatarImage(webp())).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
    expect(sniffAvatarImage(png)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffAvatarImage(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('refuses a payload that is not an image, whatever it claims to be', () => {
    // The whole point of sniffing: no declared content type is consulted, so an
    // HTML payload cannot be stored and served back as HTML.
    expect(sniffAvatarImage(Buffer.from('<html>hi</html>'))).toBeNull();
  });

  it('refuses a RIFF container that is not WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(sniffAvatarImage(wav)).toBeNull();
  });

  it('refuses an empty payload', () => {
    expect(sniffAvatarImage(Buffer.alloc(0))).toBeNull();
  });

  it('refuses anything over the cap before looking at a signature', () => {
    const oversized = Buffer.concat([webp(), Buffer.alloc(MAX_AVATAR_BYTES)]);
    expect(sniffAvatarImage(oversized)).toBeNull();
  });

  it('accepts a payload exactly at the cap', () => {
    const exact = Buffer.concat([
      webp(),
      Buffer.alloc(MAX_AVATAR_BYTES - webp().length),
    ]);
    expect(exact.length).toBe(MAX_AVATAR_BYTES);
    expect(sniffAvatarImage(exact)).not.toBeNull();
  });
});

describe('buildAvatarKey', () => {
  const type = { mime: 'image/webp', ext: 'webp' };
  const segments = (key: string) => key.split('/');

  it('namespaces the object under the owning user', () => {
    const key = buildAvatarKey('user_1', webp(), type);
    expect(segments(key).slice(0, 2)).toEqual(['avatars', 'user_1']);
    expect(key.endsWith('.webp')).toBe(true);
  });

  it('produces a different key for the same bytes each time', () => {
    // The random half. A hash-only key would be recomputable by anyone holding
    // the same image and the user id — and a Google-imported avatar's bytes are
    // a public artifact.
    const bytes = webp();
    expect(buildAvatarKey('user_1', bytes, type)).not.toBe(
      buildAvatarKey('user_1', bytes, type),
    );
  });

  it('keeps the hash segment stable for the same bytes', () => {
    const bytes = webp();
    const hashOf = (key: string) =>
      segments(key)[2]!.split('-')[1]!.split('.')[0];
    expect(hashOf(buildAvatarKey('user_1', bytes, type))).toBe(
      hashOf(buildAvatarKey('user_1', bytes, type)),
    );
  });

  it('changes the hash segment when the bytes change', () => {
    // What makes replacement cache-safe: new bytes are a new URL, so a cached
    // copy of the old avatar can never be served for the new one.
    const hashOf = (key: string) =>
      segments(key)[2]!.split('-')[1]!.split('.')[0];
    expect(hashOf(buildAvatarKey('user_1', webp('a'), type))).not.toBe(
      hashOf(buildAvatarKey('user_1', webp('b'), type)),
    );
  });
});
