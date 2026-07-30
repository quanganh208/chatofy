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

/**
 * Default distance ahead of {@link SpeechGateOptions.maxUtteranceMs} at which the
 * gate starts looking for somewhere quiet to cut.
 */
const CUT_LOOKAHEAD_MS = 500;

/** Why a turn ended. */
export type SpeechEndReason =
  /** Silence outlasted {@link SPEECH_HANGOVER_MS}: the speaker stopped. */
  | 'hangover'
  /**
   * The utterance hit its length ceiling and was cut while the speaker carried
   * on. Whatever the caller is holding back belongs to the turn being closed,
   * because there is more speech coming rather than trailing silence.
   */
  | 'forced';

export interface SpeechGateHandlers {
  /** The speaker started. */
  onSpeechStart?: () => void;
  /** Silence has lasted {@link PROBABLE_END_MS}; the turn is probably over. */
  onProbableEnd?: () => void;
  /** The turn is over; `reason` says which way it ended. */
  onSpeechEnd?: (reason: SpeechEndReason) => void;
}

export interface SpeechGateOptions {
  /**
   * Longest a single turn may run before it is cut, or 0 to never cut.
   *
   * Off by default, which is what keeps the one-turn web page behaving exactly as
   * it did. It exists for continuous capture: in a real meeting people speak for
   * tens of seconds without ever leaving {@link SPEECH_HANGOVER_MS} of silence, so
   * a gate that only ends turns on silence would open one turn and never close
   * it.
   */
  maxUtteranceMs?: number;
  /**
   * How far before the ceiling to start looking for a quiet block to cut at.
   *
   * The cut looks FORWARD, never back. An earlier design picked the quietest
   * block in the last ~500ms and reassigned everything after it to the next turn,
   * which cannot be built: the caller forwards each speech block the moment it
   * arrives and keeps no copy, so those blocks are already in the previous turn's
   * buffer on the server. Re-sending them would translate the same words twice
   * and not sending them would lose the head of the next turn. This gate cannot
   * even see the blocks — it is handed a level and a duration.
   */
  cutLookaheadMs?: number;
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
  /**
   * How long the open turn has run, pauses included.
   *
   * Counts wall time inside the turn rather than speech only: the ceiling exists
   * to bound how far a translation can fall behind the speaker, and a pause delays
   * the listener exactly as much as speech does.
   */
  private utteranceMs = 0;
  /** Past the lookahead mark: the next quiet block is the cut. */
  private armed = false;

  private readonly maxUtteranceMs: number;
  private readonly cutLookaheadMs: number;

  constructor(
    private readonly handlers: SpeechGateHandlers = {},
    options: SpeechGateOptions = {},
  ) {
    this.maxUtteranceMs = options.maxUtteranceMs ?? 0;
    this.cutLookaheadMs = options.cutLookaheadMs ?? CUT_LOOKAHEAD_MS;
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
      if (this.speaking) {
        this.utteranceMs += durationMs;
        this.armIfDue();
        // Nowhere quiet turned up inside the lookahead, so the turn is cut
        // mid-word. Worse for translation quality than a pause would be, and the
        // trade the ceiling exists to make: a turn that never ends never plays.
        if (this.hasCeiling && this.utteranceMs >= this.maxUtteranceMs) {
          this.cut();
        }
      }
      return true;
    }

    // Silence that never became a turn is just room tone; forget it.
    if (!this.speaking) {
      this.speechMs = 0;
      return false;
    }

    this.utteranceMs += durationMs;
    this.silenceMs += durationMs;
    this.armIfDue();

    if (!this.probableEndFired && this.silenceMs >= PROBABLE_END_MS) {
      this.probableEndFired = true;
      this.handlers.onProbableEnd?.();
    }

    // Armed, and this block is quiet: this is the gap the lookahead was for.
    // Taken before the hangover check because it is always the earlier of the
    // two — the lookahead opens well before any silence run could reach the
    // hangover.
    if (this.armed) {
      this.cut();
      return false;
    }

    if (this.silenceMs >= SPEECH_HANGOVER_MS) {
      this.reset();
      this.handlers.onSpeechEnd?.('hangover');
    }

    return false;
  }

  private get hasCeiling(): boolean {
    return this.maxUtteranceMs > 0;
  }

  /**
   * Enter the window where the next quiet block ends the turn.
   *
   * Arming is also where the head start is bought. `onProbableEnd` is what tells
   * the server to begin transcribing early, and it otherwise fires only after
   * {@link PROBABLE_END_MS} of silence — which a forced cut never reaches, because
   * it happens while the speaker is still going. Without this, every cut turn
   * would pay the full price at the endpoint instead: measured on this repo,
   * first audio moves from ~870ms to ~1760ms when the guess is lost. It also holds
   * the turn's slot open longer, pushing the system into the concurrency ceiling.
   *
   * Fires once per turn, since {@link armed} is only set once and `reset()` is the
   * only way back.
   */
  private armIfDue(): void {
    if (this.armed || !this.hasCeiling) return;
    if (this.utteranceMs < this.maxUtteranceMs - this.cutLookaheadMs) return;

    this.armed = true;
    // Suppresses an immediate second call from the silence run this may be
    // sitting in; a later run resets it and may legitimately renew the guess,
    // which the server is built to accept.
    this.probableEndFired = true;
    this.handlers.onProbableEnd?.();
  }

  private cut(): void {
    this.reset();
    this.handlers.onSpeechEnd?.('forced');
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
    this.utteranceMs = 0;
    this.armed = false;
  }
}
