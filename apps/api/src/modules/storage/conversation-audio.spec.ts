import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATION_AUDIO_BYTES,
  buildConversationAudioKey,
  sniffConversationAudio,
} from './conversation-audio';

/** A WebM/Matroska header: the EBML magic, then anything. */
const webm = (tail = 'rest') =>
  Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(tail)]);

/** An MP4 header: four bytes of box length, then `ftyp`. */
const mp4 = (brand = 'M4A ') =>
  Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
  ]);

describe('sniffConversationAudio', () => {
  it('accepts WebM, which is what Chromium and Firefox record', () => {
    expect(sniffConversationAudio(webm())).toEqual({
      mime: 'audio/webm',
      ext: 'webm',
    });
  });

  it('accepts MP4, which is the only thing Safari records', () => {
    // Matched at offset 4, after the box length — not as a prefix.
    expect(sniffConversationAudio(mp4())).toEqual({
      mime: 'audio/mp4',
      ext: 'm4a',
    });
  });

  it('refuses a JSON body dressed as audio', () => {
    // The declared Content-Type is a claim; this is what makes the stored
    // ContentType trustworthy.
    expect(sniffConversationAudio(Buffer.from('{"not":"audio"}'))).toBeNull();
  });

  it('refuses WAV, which is audio but not a container this API stores', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
    ]);
    expect(sniffConversationAudio(wav)).toBeNull();
  });

  it('refuses an empty buffer', () => {
    // A zero-byte recording is a failed capture. Storing one would put a player
    // on a conversation with nothing to play.
    expect(sniffConversationAudio(Buffer.alloc(0))).toBeNull();
  });

  it('refuses a body over the cap even when the header is valid', () => {
    // Defence in depth: the parser refuses this first, but a caller reaching the
    // sniff directly must not get a pass because the first four bytes are right.
    const oversized = Buffer.concat([
      webm(),
      Buffer.alloc(MAX_CONVERSATION_AUDIO_BYTES),
    ]);
    expect(sniffConversationAudio(oversized)).toBeNull();
  });

  it('refuses a buffer too short to carry a signature', () => {
    expect(sniffConversationAudio(Buffer.from([0x1a, 0x45]))).toBeNull();
  });

  it('refuses an MP4 whose major brand is not audio-bearing', () => {
    // `isom`/`mp42` are the generic ISO-BMFF brands video uses, `qt  ` is a
    // QuickTime .mov, and `heic` is a HEIC photo — all valid `ftyp` boxes, none
    // of them something an <audio> element can play. Matching the box alone,
    // as this used to, stored and served every one of these back as
    // `audio/mp4`.
    expect(sniffConversationAudio(mp4('isom'))).toBeNull();
    expect(sniffConversationAudio(mp4('mp42'))).toBeNull();
    expect(sniffConversationAudio(mp4('qt  '))).toBeNull();
    expect(sniffConversationAudio(mp4('heic'))).toBeNull();
  });

  it('accepts the M4B audiobook brand alongside M4A', () => {
    expect(sniffConversationAudio(mp4('M4B '))).toEqual({
      mime: 'audio/mp4',
      ext: 'm4a',
    });
  });
});

describe('buildConversationAudioKey', () => {
  const webmType = { mime: 'audio/webm', ext: 'webm' };

  it('namespaces by owner and carries the extension', () => {
    const key = buildConversationAudioKey('user-1', webmType);
    expect(key).toMatch(/^conversations\/user-1\/[0-9a-f]{16}\.webm$/);
  });

  it('takes no conversation id at all, so none can leak into the key', () => {
    // The conversation id appears in the URL bar and in browser history. Since
    // the bucket is public-read, a key built from it would be readable by anyone
    // who ever saw a link — which is why this function's signature does not
    // accept one. Owner, type, entropy: three segments and nothing derivable.
    expect(buildConversationAudioKey).toHaveLength(2);
    const key = buildConversationAudioKey('user-1', webmType);
    const [prefix, owner, file] = key.split('/');
    expect([prefix, owner]).toEqual(['conversations', 'user-1']);
    expect(file).toMatch(/^[0-9a-f]{16}\.webm$/);
  });

  it('is unguessable: two keys for one owner never collide', () => {
    // 64 bits of entropy is what stands between a stored conversation and a
    // guessed one on a public-read bucket. A change that makes this deterministic
    // is a change that publishes every recording.
    const keys = new Set(
      Array.from({ length: 200 }, () =>
        buildConversationAudioKey('user-1', webmType),
      ),
    );
    expect(keys.size).toBe(200);
  });

  it('uses the sniffed extension, so an MP4 is not stored as .webm', () => {
    const key = buildConversationAudioKey('user-1', {
      mime: 'audio/mp4',
      ext: 'm4a',
    });
    expect(key.endsWith('.m4a')).toBe(true);
  });
});
