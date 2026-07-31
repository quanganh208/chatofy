/**
 * Microphone capture worklet.
 *
 * Runs on the audio thread and does as little as possible: it batches the
 * 128-sample render quanta the browser hands it into ~20ms blocks and posts
 * them to the main thread. Resampling and voice detection deliberately live in
 * plain modules there, where they can be read and reasoned about — the audio
 * thread must never be the place a bug stalls, because stalling it drops
 * samples outright.
 *
 * Loaded by URL (`audioWorklet.addModule('/worklets/mic-capture-processor.js')`),
 * so it is served as-is and never goes through the app bundler.
 */

/** Samples per posted block, at the context's own rate. ~20ms at 48 kHz. */
const BLOCK_SAMPLES = 1024;

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BLOCK_SAMPLES);
    this._filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input connected yet, or the track ended. Staying alive lets capture
    // resume without rebuilding the graph.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._filled++] = channel[i];
      if (this._filled === BLOCK_SAMPLES) {
        // Transfer a copy: the buffer is reused immediately for the next block.
        const block = this._buffer.slice(0);
        this.port.postMessage(block, [block.buffer]);
        this._filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('mic-capture-processor', MicCaptureProcessor);
