/**
 * Denoise worklet — the transform `MicrophoneGraph` splices between the
 * microphone and capture.
 *
 * It reframes the browser's 128-sample quanta into the 480-sample frames RNNoise
 * takes (via `RnnoiseFrameBuffer`, which is where the tested logic lives) and
 * writes the cleaned samples straight back out, one for one. Because it emits the
 * same count it consumes it is a transform, not a gate — the capture worklet
 * downstream still sees every block, trailing quiet included.
 *
 * **Status: transform-correct skeleton — it does not yet denoise.** The RNNoise
 * WASM binding drops into `denoiseFrame` below and ONLY there. It is left out for
 * two reasons, both from the plan: the library is a measured choice
 * (`@jitsi/rnnoise-wasm` vs `rnnoise-wasm` vs a hand-built worklet, picked on
 * asset size and worklet ergonomics), and whether it should run at all on top of
 * the browser's own `noiseSuppression` is what the noisy-WER arm in
 * `benchmarks/noise` measures. Until that lands this frames and passes audio
 * through unchanged, so the graph path is real and exercised while the model is
 * still a passthrough. It is off by default at the graph — nothing builds this
 * node unless a caller supplies it — so a skeleton on disk changes no behaviour.
 *
 * A module worklet (it `import`s the frame buffer), unlike the classic
 * `mic-capture-processor.js`; both are served as-is and never bundled.
 */
import { RnnoiseFrameBuffer } from './rnnoise-frame-buffer.js';

/**
 * Clean one 480-sample frame. Passthrough for now — return the frame unchanged.
 *
 * The RNNoise drop-in goes here: instantiate the model from a WASM binary handed
 * in through `processorOptions` (a worklet cannot fetch), and return its denoised
 * 480-sample output. Keep the binding to this one function so swapping the
 * library after the measurement touches nothing else.
 *
 * @param {Float32Array} frame
 * @returns {Float32Array}
 */
function denoiseFrame(frame) {
  return frame;
}

class RnnoiseDenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new RnnoiseFrameBuffer(denoiseFrame);
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    // No output channel means the node is being torn down; nothing to do.
    if (!output) return true;
    // No input yet, or the track ended: emit silence and stay alive so capture
    // can resume without the graph being rebuilt, exactly as the capture worklet
    // does.
    if (!input) {
      output.fill(0);
      return true;
    }
    output.set(this._buffer.process(input));
    return true;
  }
}

registerProcessor('rnnoise-denoise', RnnoiseDenoiseProcessor);
