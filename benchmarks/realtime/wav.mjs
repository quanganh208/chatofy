// Minimal 16-bit PCM WAV reading and writing, shared by the harness scripts.
//
// Extracted rather than copied: `prefix-stability.mjs` slices a growing buffer
// and `fetch-dataset-fixtures.mjs` joins clips into passages, and both were about
// to carry their own header parser. Two parsers drift, and a drift here is silent
// — the recogniser is handed bytes either way and simply transcribes noise.
//
// Deliberately not a general WAV library. It handles the one format everything in
// this pipeline speaks (16-bit PCM), and refuses anything else loudly rather than
// producing plausible garbage.

/**
 * Read a WAV into `{ channels, sampleRate, bitsPerSample, pcm }`.
 *
 * Walks the chunk list instead of assuming the canonical 44-byte header. Files
 * from other tools — and dataset exports in particular — carry `LIST` or `fact`
 * chunks before `data`, and slicing at a fixed offset would feed those bytes to
 * the recogniser as if they were audio.
 */
export function openWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') {
      fmt = {
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      if (fmt.bitsPerSample !== 16) {
        throw new Error(`need 16-bit PCM, got ${fmt.bitsPerSample}-bit`);
      }
      return { ...fmt, pcm: body };
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte that is not
    // counted in the size field. Skipping it desynchronises every later chunk.
    offset += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

/** Wrap raw PCM16 in a canonical WAV header. */
export function writeWav({ channels, sampleRate }, pcm) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

/** A WAV holding only the first `byteLength` bytes of `audio`'s body. */
export function sliceWav(audio, byteLength) {
  return writeWav(audio, audio.pcm.subarray(0, byteLength));
}

export const bytesPerMs = ({ sampleRate, channels }) => (sampleRate * channels * 2) / 1000;

export const durationMs = (audio) => Math.floor(audio.pcm.length / bytesPerMs(audio));

/** A run of digital silence, in the same format as `audio`. */
export const silence = (audio, ms) => Buffer.alloc(Math.round(ms * bytesPerMs(audio)));

/**
 * Join clips into one passage, separated by `gapMs` of silence.
 *
 * Refuses to mix sample rates or channel counts rather than resampling. A silent
 * resample would be the worst possible failure here: the fixture would still play,
 * the recogniser would still return words, and every latency number taken from it
 * would be wrong by whatever the rate ratio happened to be. The caller knows which
 * dataset it is holding and can pick clips that agree.
 */
export function concatClips(clips, gapMs) {
  if (clips.length === 0) throw new Error('no clips to join');
  const { sampleRate, channels } = clips[0];
  const mismatch = clips.find((c) => c.sampleRate !== sampleRate || c.channels !== channels);
  if (mismatch) {
    throw new Error(
      `cannot join ${sampleRate}Hz/${channels}ch with ${mismatch.sampleRate}Hz/${mismatch.channels}ch — ` +
        'select clips of one format instead of resampling',
    );
  }

  const gap = silence(clips[0], gapMs);
  const parts = [];
  clips.forEach((clip, index) => {
    if (index > 0) parts.push(gap);
    parts.push(clip.pcm);
  });
  return { sampleRate, channels, pcm: Buffer.concat(parts) };
}
