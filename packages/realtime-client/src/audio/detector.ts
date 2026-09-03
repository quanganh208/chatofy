/**
 * Whether a block is speech — the one decision `SpeechGate` delegates.
 *
 * The gate owns endpoint POLICY: the hangover, the probable-end head start, the
 * length ceiling. This owns only the call of speech versus silence. Splitting the
 * two is what lets a learned voice-activity detector replace the level threshold
 * without touching a line of the policy that turned out to be where this
 * project's most expensive defects lived.
 *
 * The default {@link RmsDetector} is level against an adaptive noise floor and
 * needs no dependency, so a build that cannot serve a model still works. The
 * opt-in one is Silero (`@ricky0123/vad-web`: onnxruntime-web plus a WASM model
 * asset), more robust in a noisy room — the gain is measured against the RMS
 * floor in `benchmarks/noise`. Silero reads the waveform rather than the level,
 * so when it lands the block travels alongside the level through {@link
 * Detector.detect}; the RMS detector ignores it, and the signature carries both
 * so neither impl has to reach for something it was not handed.
 */

/** Level above the noise floor that counts as speech. */
const SPEECH_MARGIN = 0.018;

/** Floor below which a room is treated as silent regardless of what it learnt. */
const MIN_NOISE_FLOOR = 0.004;

/** How fast the noise floor tracks the room. Rises slowly, falls quickly. */
const FLOOR_RISE = 0.002;
const FLOOR_FALL = 0.05;

/**
 * Decides speech versus silence, one block at a time.
 *
 * Implementations hold whatever state their method needs (the RMS floor, a
 * model's session) and are fed blocks in order — never rewound, never skipped.
 */
export interface Detector {
  /**
   * Is the block that just arrived speech?
   *
   * `rms` is its level in 0..1, `durationMs` how much time it covers. A level
   * detector needs only the first; a learned one uses the timing, and will read
   * the waveform once it is threaded through here — the signature is where it
   * goes so the interface does not have to change under it.
   */
  detect(rms: number, durationMs: number): boolean;
}

/**
 * Speech is level over an adaptive noise floor.
 *
 * The floor rises slowly and falls fast, and adapts **only on silence**: letting
 * speech raise it would make the detector deafen itself part-way through a long
 * sentence. It is deliberately not reset between turns — the room it learnt does
 * not change when a turn is gated for playback, and forgetting it would re-pay
 * the cold start. This is the exact level logic the gate carried before the
 * detector was pulled out of it, so its behaviour is unchanged.
 */
export class RmsDetector implements Detector {
  private noiseFloor = MIN_NOISE_FLOOR;

  detect(rms: number): boolean {
    const isSpeech = rms > this.noiseFloor + SPEECH_MARGIN;

    if (!isSpeech) {
      const target = Math.max(MIN_NOISE_FLOOR, rms);
      const rate = target > this.noiseFloor ? FLOOR_RISE : FLOOR_FALL;
      this.noiseFloor += (target - this.noiseFloor) * rate;
    }

    return isSpeech;
  }
}
