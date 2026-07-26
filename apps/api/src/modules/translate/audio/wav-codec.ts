// Minimal RIFF/WAVE codec for the WebSocket audio path.
//
// Two conversions, both forced by boundaries this app does not own:
//
//  - Inbound: the client streams raw PCM16 frames, but the STT sidecar decodes
//    with PyAV, which opens a *container* — headerless samples fail to decode.
//    So a turn's frames get a WAV header before they are transcribed.
//  - Outbound: the TTS sidecar returns a WAV file, but the shared
//    `audioFrameSchema` carries raw samples (`encoding: 'pcm16'`) plus a rate.
//    Raw samples are also what lets consecutive chunks be played back to back
//    without re-parsing a container per chunk.
//
// Only 16-bit PCM is handled, which is what the local TTS sidecar writes
// (`sf.write(..., subtype="PCM_16")`). Anything else raises rather than being
// reinterpreted, because silently misreading sample width produces noise that
// sounds like a model failure.

/** Uncompressed 16-bit PCM audio and the rate it must be played at. */
export interface Pcm16Audio {
  /** Interleaved 16-bit little-endian samples. */
  samples: Buffer;
  sampleRate: number;
  channels: number;
}

/** Raised when a payload is not the 16-bit PCM WAVE this path supports. */
export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavFormatError';
  }
}

/** WAVE `audioFormat` code for uncompressed PCM. */
const WAVE_FORMAT_PCM = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
/** `fmt ` + `data` chunk headers plus the RIFF descriptor. */
const HEADER_BYTES = 44;

/** Wrap raw PCM16 samples in a canonical 44-byte WAVE header. */
export function encodePcm16Wav({
  samples,
  sampleRate,
  channels,
}: Pcm16Audio): Buffer {
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const header = Buffer.alloc(HEADER_BYTES);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(HEADER_BYTES - 8 + samples.length, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk body size
  header.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);

  return Buffer.concat([header, samples]);
}

interface WaveFormat {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * Read a 16-bit PCM WAVE payload back into raw samples.
 *
 * Chunks are walked rather than assumed at fixed offsets: encoders are free to
 * emit `LIST`/`fact` chunks before `data`, so a hard-coded 44-byte skip would
 * silently treat metadata as audio.
 */
export function decodeWavToPcm16(wav: Buffer): Pcm16Audio {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new WavFormatError('payload is not a RIFF/WAVE file');
  }

  let format: WaveFormat | null = null;
  let samples: Buffer | null = null;
  let offset = 12;

  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const declaredSize = wav.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === 'fmt ' && declaredSize >= 16 && body + 16 <= wav.length) {
      format = {
        audioFormat: wav.readUInt16LE(body),
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bitsPerSample: wav.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      // A writer that streamed its output can leave the size field at 0 or
      // unfinished; trusting the remaining bytes recovers the audio instead of
      // returning an empty buffer.
      const unfinished = declaredSize === 0 || body + declaredSize > wav.length;
      const end = unfinished ? wav.length : body + declaredSize;
      samples = wav.subarray(body, end);
      // Everything left IS the audio, so the walk must not continue into it —
      // PCM that happens to spell "fmt " or "data" would otherwise be parsed as
      // a chunk header and overwrite what was just read.
      if (unfinished) break;
    }

    // RIFF chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + declaredSize + (declaredSize % 2);
  }

  if (!format) throw new WavFormatError('WAVE payload has no fmt chunk');
  if (!samples) throw new WavFormatError('WAVE payload has no data chunk');
  if (format.audioFormat !== WAVE_FORMAT_PCM) {
    throw new WavFormatError(
      `WAVE payload is not uncompressed PCM (audioFormat=${format.audioFormat})`,
    );
  }
  if (format.bitsPerSample !== BITS_PER_SAMPLE) {
    throw new WavFormatError(
      `WAVE payload is ${format.bitsPerSample}-bit; only ${BITS_PER_SAMPLE}-bit is supported`,
    );
  }
  // Both are divisors when the samples are cut into playable frames, and a zero
  // would turn that into an endless loop rather than an error.
  if (format.channels < 1) {
    throw new WavFormatError(
      `WAVE payload declares ${format.channels} channels`,
    );
  }
  if (format.sampleRate < 1) {
    throw new WavFormatError(
      `WAVE payload declares a sample rate of ${format.sampleRate}`,
    );
  }

  return {
    samples,
    sampleRate: format.sampleRate,
    channels: format.channels,
  };
}
