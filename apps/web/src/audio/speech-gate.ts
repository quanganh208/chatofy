/**
 * Decides when a turn is over, so nobody has to press a button.
 *
 * This is the single largest knob in the latency budget that this file controls.
 * Measured end to end over 32 turns, from the moment the speaker stops to the
 * first sample of translated audio: **p50 1163ms, p95 2983ms**.
 *
 * Where it goes, per stage: STT 58ms, translation 723ms, first clause of speech
 * 527ms. The hangover below sits on top of all of it and is the only term that
 * is pure policy rather than compute. Lowering it makes the app feel
 * dramatically faster and starts cutting people off mid-sentence; that trade is
 * why it is a named constant and not a number buried in a condition.
 *
 * The p95 misses its 1.8s target and this constant cannot fix it: the tail is
 * the translation API (p95 1947ms, worst 8943ms), which is a network away.
 *
 * Detection is root-mean-square level against an adaptive noise floor. A
 * learned detector (Silero via `@ricky0123/vad-web`) is more robust in a noisy
 * room, at the cost of `onnxruntime-web` plus WASM and model assets to serve.
 * The latency win comes from ending the turn automatically at all, not from
 * which detector decides — so this stays dependency-free behind an interface
 * that a learned detector can be dropped into.
 */

/**
 * Silence before the turn is declared over. ~40% of the latency budget.
 * Shorter feels faster and cuts people off; longer is safer and feels sluggish.
 */
const SPEECH_HANGOVER_MS = 500;

/**
 * Silence before the turn is *suspected* to be over. The server starts
 * transcribing and translating at this point, so a confirmed endpoint at
 * `SPEECH_HANGOVER_MS` can find that work already ~350ms along.
 *
 * The server renews its guess at each of these, keeping only the latest, so a
 * speaker who pauses mid-sentence no longer loses the head start to that pause.
 * It used to take one guess per turn: measured over 32 synthesized Vietnamese
 * turns that survived only 19, and the gap was large — 870ms to first audio
 * when it held, 1760ms when it did not. See `capture-pump.replay.spec.ts`.
 *
 * Every guess costs a translation request against a per-model per-minute
 * ceiling and all but the last are discarded, which is why this is not lowered
 * further and why the server caps how many a turn may spend.
 */
const PROBABLE_END_MS = 150;

/** Speech must outlast this to open a turn, so a cough is not an utterance. */
const MIN_SPEECH_MS = 120;

/** Level above the noise floor that counts as speech. */
const SPEECH_MARGIN = 0.018;

/** Floor below which a room is treated as silent regardless of what it learnt. */
const MIN_NOISE_FLOOR = 0.004;

/** How fast the noise floor tracks the room. Rises slowly, falls quickly. */
const FLOOR_RISE = 0.002;
const FLOOR_FALL = 0.05;

export interface SpeechGateHandlers {
  /** The speaker started. */
  onSpeechStart?: () => void;
  /** Silence has lasted {@link PROBABLE_END_MS}; the turn is probably over. */
  onProbableEnd?: () => void;
  /** Silence has lasted {@link SPEECH_HANGOVER_MS}; the turn is over. */
  onSpeechEnd?: () => void;
}

/**
 * Streaming endpoint detector.
 *
 * Fed one block of audio at a time along with how long that block covers, so it
 * never has to know the sample rate or guess at wall-clock timing.
 */
export class SpeechGate {
  private noiseFloor = MIN_NOISE_FLOOR;
  private speaking = false;
  /** Milliseconds of consecutive speech before a turn is opened. */
  private speechMs = 0;
  /** Milliseconds of silence since the last speech block. */
  private silenceMs = 0;
  private probableEndFired = false;

  constructor(private readonly handlers: SpeechGateHandlers = {}) {}

  /** True once speech has been confirmed and the turn has not yet ended. */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Current noise floor — useful for a level meter or for diagnosing a room. */
  get level(): number {
    return this.noiseFloor;
  }

  /**
   * Feed one block. `rms` is the block's level (0..1), `durationMs` how much
   * time it covers.
   *
   * Returns whether the block counted as speech. The caller needs this to
   * decide whether to send the block onward, and deriving it a second time
   * there would mean two copies of the threshold — which would drift.
   */
  push(rms: number, durationMs: number): boolean {
    const isSpeech = rms > this.noiseFloor + SPEECH_MARGIN;

    // Only adapt on silence: letting speech raise the floor would make the
    // detector deafen itself part-way through a long sentence.
    if (!isSpeech) {
      const target = Math.max(MIN_NOISE_FLOOR, rms);
      const rate = target > this.noiseFloor ? FLOOR_RISE : FLOOR_FALL;
      this.noiseFloor += (target - this.noiseFloor) * rate;
    }

    if (isSpeech) {
      this.silenceMs = 0;
      this.probableEndFired = false;
      this.speechMs += durationMs;
      if (!this.speaking && this.speechMs >= MIN_SPEECH_MS) {
        this.speaking = true;
        this.handlers.onSpeechStart?.();
      }
      return true;
    }

    // Silence that never became a turn is just room tone; forget it.
    if (!this.speaking) {
      this.speechMs = 0;
      return false;
    }

    this.silenceMs += durationMs;

    if (!this.probableEndFired && this.silenceMs >= PROBABLE_END_MS) {
      this.probableEndFired = true;
      this.handlers.onProbableEnd?.();
    }

    if (this.silenceMs >= SPEECH_HANGOVER_MS) {
      this.reset();
      this.handlers.onSpeechEnd?.();
    }

    return false;
  }

  /**
   * Forget the current utterance without emitting anything.
   *
   * Used when capture is gated — while translated speech is playing, the
   * microphone hears the loudspeaker, and carrying that state across the gap
   * would end a turn that never started.
   */
  reset(): void {
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.probableEndFired = false;
  }
}
