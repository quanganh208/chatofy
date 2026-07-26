/**
 * Microphone float samples → the 16 kHz mono PCM16 the STT models were trained
 * on.
 *
 * Both conversions are forced, not stylistic: browsers capture at the output
 * device's rate (usually 44.1 or 48 kHz) and hand out floats, while the shared
 * `audioFrameSchema` carries `pcm16` and the sidecar's models are 16 kHz. Doing
 * this in the app rather than leaning on the sidecar's resampler also cuts what
 * goes over the socket to a third.
 */

/** Rate both Zipformer-vi and Moonshine-en are trained at. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Resample and quantise one block of mono float samples.
 *
 * Linear interpolation is enough here: the common case is an integer ratio
 * (48000 → 16000 is exactly 3:1), and speech recognition is unbothered by the
 * aliasing a sharper filter would remove.
 *
 * Each block restarts at position 0, so a non-integer ratio loses the
 * fractional remainder at every block boundary rather than carrying phase
 * across. That is a fraction of a sample every ~20ms and inaudible to a
 * recogniser; it does mean the output is not sample-exact against a one-shot
 * resample of the whole utterance.
 */
export function downsampleToPcm16(
  input: Float32Array,
  inputRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Int16Array {
  if (inputRate <= 0) throw new RangeError(`invalid input rate ${inputRate}`);

  const ratio = inputRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    const sample = input[left]! * (1 - weight) + input[right]! * weight;
    output[i] = floatToPcm16(sample);
  }

  return output;
}

/**
 * One float sample to signed 16-bit.
 *
 * Clamped before scaling: a sample slightly outside [-1, 1] — which a gain
 * stage can easily produce — would otherwise wrap to the opposite polarity and
 * be heard as a click rather than as clipping.
 */
function floatToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff));
}

/** Root-mean-square level of a PCM16 block, normalised to 0..1. */
export function pcm16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]! / 0x8000;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Base64 for the wire — `audioFrameSchema.payload` carries text, not bytes. */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  // Chunked so a long block cannot blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Inverse of {@link pcm16ToBase64}, for audio arriving from the server. */
export function base64ToPcm16(payload: string): Int16Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // An odd length is a framing error, not a sample to round off: `Int16Array`
  // would silently drop the trailing byte and every later sample would be one
  // byte out of phase, which is heard as noise rather than as an error.
  if (bytes.byteLength % 2 !== 0) {
    throw new RangeError(
      `pcm16 payload has ${bytes.byteLength} bytes, which is not a whole number of samples`,
    );
  }
  return new Int16Array(bytes.buffer, 0, bytes.byteLength / 2);
}
