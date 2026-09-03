/**
 * Reframes a stream of render quanta into the fixed 480-sample frames RNNoise
 * takes, and hands the cleaned samples back **one output sample per input
 * sample** — which is the whole reason denoise can sit in the capture graph
 * without being a gate.
 *
 * The browser delivers audio in 128-sample quanta; RNNoise processes exactly
 * 480 samples (10ms at 48 kHz) at a time. This bridges the two: it accumulates
 * input until a frame is full, denoises the frame, and returns as many samples
 * as it was given this call. The sample count out always equals the sample count
 * in, so the node downstream sees every block, trailing quiet included.
 *
 * Frames arrive in 480-sample bursts while output is drawn a steady 128 at a
 * time, so a naive pipe underruns — it empties mid-stream and emits a hole,
 * which is a click, not a gap in speech. So output is held back through a short
 * warm-up (two frames) before it starts, buying a cushion large enough that a
 * burst never arrives late. The cost is that fixed warm-up of latency, ~20ms,
 * paid once at the start of capture; steady state adds nothing.
 *
 * A plain `.js` in `worklets/` rather than a module in `src/`, for the same
 * reason `mic-capture-processor.js` is: a worklet is served as-is and cannot
 * import the bundled package. It is imported by both the denoise worklet and its
 * spec, so the logic has one home and is tested for what it promises — equal
 * counts and a faithful passthrough under an identity denoiser.
 */

/** RNNoise's frame: 480 samples, 10ms at 48 kHz. */
export const RNNOISE_FRAME_SIZE = 480;

export class RnnoiseFrameBuffer {
  /**
   * @param {(frame: Float32Array) => Float32Array} denoiseFrame
   *   Cleans one `frameSize`-sample frame and returns one the same length.
   * @param {number} [frameSize]
   */
  constructor(denoiseFrame, frameSize = RNNOISE_FRAME_SIZE) {
    if (typeof denoiseFrame !== 'function') {
      throw new TypeError('denoiseFrame must be a function');
    }
    this._denoiseFrame = denoiseFrame;
    this._frameSize = frameSize;
    /**
     * Output stays held until two frames are denoised and waiting. One frame is
     * not enough: bursts are 480 wide and up to four 128-quanta (512 samples)
     * can be drawn between two of them, so a single-frame cushion runs dry by the
     * fourth. Two frames clears that worst case with margin.
     */
    this._warmupSamples = frameSize * 2;
    this._warm = false;
    /** Input not yet formed into a full frame. */
    this._pending = new Float32Array(0);
    /** Denoised samples not yet returned. */
    this._ready = new Float32Array(0);
  }

  /**
   * Feed one quantum; get back the same number of denoised samples.
   * @param {Float32Array} input
   * @returns {Float32Array}
   */
  process(input) {
    this._pending = concat(this._pending, input);

    while (this._pending.length >= this._frameSize) {
      const frame = this._pending.subarray(0, this._frameSize);
      const cleaned = this._denoiseFrame(frame);
      if (cleaned.length !== this._frameSize) {
        throw new RangeError(
          `denoiseFrame returned ${cleaned.length} samples, expected ${this._frameSize}`,
        );
      }
      this._ready = concat(this._ready, cleaned);
      this._pending = this._pending.slice(this._frameSize);
    }

    // Always return exactly what arrived. Before warm-up that is leading
    // silence, never fewer samples — withholding any would make this a gate.
    if (!this._warm && this._ready.length >= this._warmupSamples) {
      this._warm = true;
    }
    const out = new Float32Array(input.length);
    if (this._warm) {
      // Post warm-up the cushion guarantees enough is ready, so this is a full
      // copy every call — no mid-stream hole.
      out.set(this._ready.subarray(0, input.length));
      this._ready = this._ready.slice(input.length);
    }
    return out;
  }
}

/** @param {Float32Array} a @param {Float32Array} b */
function concat(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
