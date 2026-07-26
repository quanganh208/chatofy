import { SpeechGate } from './speech-gate';
import { pcm16Rms, TARGET_SAMPLE_RATE } from './pcm-resampler';

/**
 * Decides what happens to every captured block: whether it opens a turn, feeds
 * one, or is thrown away.
 *
 * Split out of the React hook deliberately. This is the whole turn-taking
 * policy, it is pure apart from the callbacks, and it is where a mistake is
 * invisible — an earlier revision closed the microphone on speech *start*
 * instead of speech *end*, so every turn sent one block and then hung forever.
 * Typecheck, lint and build all passed. Only a test of this ordering catches it,
 * which is why the ordering lives somewhere a test can reach.
 */

/**
 * Audio kept from just before speech is confirmed.
 *
 * The gate needs a moment of sound before it will call something an utterance;
 * without this the first syllable of every turn would already be gone by then.
 */
const PRE_ROLL_MS = 320;

/** Where the pump is in the turn cycle. */
export type CaptureState =
  /** Listening for someone to start talking. */
  | 'idle'
  /** Someone is talking; their audio is being forwarded. */
  | 'in-turn'
  /**
   * They stopped. The microphone is ignored until the caller says the turn is
   * finished — which means its translation has been spoken, not merely
   * received. This is the half-duplex window: two people sharing one phone
   * otherwise get a loop where the loudspeaker feeds the microphone and the app
   * translates itself forever.
   */
  | 'awaiting-result';

export interface CapturePumpHandlers {
  /**
   * Speech confirmed. `preRoll` is the audio captured just before, in order,
   * and belongs at the start of the turn.
   */
  onTurnOpen: (preRoll: Int16Array[]) => void;
  /** A block belonging to the open turn. */
  onAudio: (block: Int16Array) => void;
  /** Silence long enough to suspect the turn is over, but not to declare it. */
  onProbableEnd: () => void;
  /** Silence outlasted the hangover: the turn is over. */
  onTurnClose: () => void;
  /** Microphone level for a meter, 0 while the microphone is ignored. */
  onLevel: (level: number) => void;
  /**
   * The microphone heard speech while our own translation was playing.
   *
   * Almost always the loudspeaker feeding back. Reported rather than acted on,
   * and reported in BOTH modes — in half-duplex the microphone is ignored, so
   * without this the absence of a self-triggered turn would look like proof
   * that echo cancellation works when it only proves the microphone was off.
   */
  onEchoHeard?: () => void;
}

export class CapturePump {
  private readonly gate: SpeechGate;
  private state: CaptureState = 'idle';
  /** Rolling recent audio, so a turn does not start mid-word. */
  private preRoll: Int16Array[] = [];
  private readonly preRollBlocks: number;
  /**
   * Silence heard mid-turn, kept back rather than sent.
   *
   * The server decides whether the text it worked out early is still valid by
   * checking that its byte count has not moved since. Streaming the silence
   * that follows an utterance moves that count for audio carrying nothing, so
   * the check could never pass and the early work was always thrown away.
   *
   * Held instead: flushed intact the moment speech resumes, dropped when the
   * turn ends — at which point it is by definition nothing but silence.
   *
   * Bounded by the gate: it is emptied on speech and on end of turn, so it
   * never holds more than one hangover's worth.
   */
  private held: Int16Array[] = [];

  /**
   * Hears what the microphone picks up while our own audio plays, so the echo
   * can be counted without acting on it.
   */
  private readonly echoGate: SpeechGate;

  constructor(
    private readonly handlers: CapturePumpHandlers,
    /** Samples per block, needed to size the pre-roll and time the gate. */
    private readonly blockSamples: number,
    /**
     * Keep listening while our own translation plays.
     *
     * Off by default and meant to stay that way until echo cancellation has
     * been measured on the actual device: with it on, the loudspeaker feeds the
     * microphone and the app translates itself in a loop. See
     * {@link CapturePumpHandlers.onEchoHeard} for the measurement.
     */
    private readonly fullDuplex = false,
  ) {
    const blockMs = (blockSamples / TARGET_SAMPLE_RATE) * 1000;
    this.preRollBlocks = Math.max(1, Math.round(PRE_ROLL_MS / blockMs));
    this.gate = new SpeechGate({
      onSpeechStart: () => {
        this.state = 'in-turn';
        const preRoll = this.preRoll;
        this.preRoll = [];
        this.handlers.onTurnOpen(preRoll);
      },
      onProbableEnd: () => {
        // Release the tail before letting the server take its snapshot, so the
        // recogniser still hears the end of the last word.
        //
        // Holding silence keeps the byte count still, which is what makes the
        // early work reusable — but a word does not end where the level drops
        // below the gate's threshold. Final unvoiced consonants sit well under
        // the vowel before them, and discarding everything quiet would clip
        // them off every utterance. Flushing here puts them inside the
        // snapshot; only the silence that follows it stays held, and that is
        // silence the recogniser has no use for.
        this.flushHeld();
        this.handlers.onProbableEnd();
      },
      onSpeechEnd: () => {
        // Stop listening here, not at speech start: everything between these
        // two points is the utterance being translated.
        this.state = 'awaiting-result';
        this.preRoll = [];
        // Everything held back is the silence that ended the turn.
        this.held = [];
        this.handlers.onLevel(0);
        this.handlers.onTurnClose();
      },
    });

    this.echoGate = new SpeechGate({
      onSpeechStart: () => this.handlers.onEchoHeard?.(),
    });
  }

  get currentState(): CaptureState {
    return this.state;
  }

  /** True while the microphone is deliberately ignored. */
  get isMuted(): boolean {
    return this.state === 'awaiting-result';
  }

  /** Feed one block of 16 kHz mono PCM16 from the microphone. */
  push(block: Int16Array): void {
    const blockMs = (block.length / TARGET_SAMPLE_RATE) * 1000;

    const rms = pcm16Rms(block);

    if (this.state === 'awaiting-result') {
      // Our own translation is playing, so whatever comes back is the room and
      // the loudspeaker. Counted on a gate of its own regardless of mode: how
      // much of our own audio returns is the number that decides whether
      // listening through playback is possible at all, and a microphone that is
      // switched off cannot measure it.
      this.echoGate.push(rms, blockMs);
      if (!this.fullDuplex) {
        this.gate.reset();
        return;
      }
    }

    this.handlers.onLevel(rms);
    // May flip the state through onSpeechStart / onSpeechEnd.
    const isSpeech = this.gate.push(rms, blockMs);

    if (this.state === 'in-turn') {
      if (!isSpeech) {
        // Might be a pause inside the utterance, might be its end. Hold it
        // until the gate decides which, so the server's byte count stays put.
        this.held.push(block);
        return;
      }
      // Speech resumed, so the pause was internal after all: the held audio is
      // part of the utterance and goes first, in order.
      this.flushHeld();
      this.handlers.onAudio(block);
      return;
    }

    if (this.state === 'idle') {
      this.preRoll.push(block);
      if (this.preRoll.length > this.preRollBlocks) this.preRoll.shift();
    }
  }

  /**
   * Start listening again. The caller must only do this once the finished turn
   * has both ended server-side AND played out — releasing on either alone
   * reopens the microphone into our own audio.
   */
  armNextTurn(): void {
    this.state = 'idle';
    this.preRoll = [];
    this.held = [];
    this.gate.reset();
    this.echoGate.reset();
  }

  /** Forget everything, e.g. when the conversation is torn down. */
  reset(): void {
    this.armNextTurn();
  }

  /**
   * Send everything held back, oldest first, and stop holding it.
   *
   * Emptied before the first callback rather than after the last: if a handler
   * throws part-way, the blocks already sent are gone from the queue and a
   * later flush cannot send them a second time. Duplicated audio corrupts the
   * utterance, where a dropped block only shortens it.
   */
  private flushHeld(): void {
    if (!this.held.length) return;
    const pending = this.held;
    this.held = [];
    for (const block of pending) this.handlers.onAudio(block);
  }

  /** Milliseconds one block covers — the pre-roll window is derived from it. */
  get blockDurationMs(): number {
    return (this.blockSamples / TARGET_SAMPLE_RATE) * 1000;
  }
}
