/**
 * Plays translated speech as it arrives, chunk by chunk.
 *
 * The server sends ~200ms of raw PCM per frame and starts sending before the
 * whole turn is synthesized — that is the point of the streaming path. Playing
 * each chunk with `new Audio()` would insert a gap at every seam. Instead each
 * chunk is scheduled on the Web Audio clock at the exact moment the previous
 * one ends, which is sample-accurate and inaudible.
 *
 * Measured server-side, a clause's audio always outlasts the time needed to
 * synthesize the clause after it, so the queue stays ahead of playback and the
 * turn is heard as one continuous utterance.
 */

/**
 * Cushion before the first chunk starts, absorbing jitter between socket
 * frames. Small enough not to register as delay, large enough that a late frame
 * does not underrun the clock.
 */
const START_CUSHION_S = 0.06;

export class PcmPlaybackQueue {
  /** Web Audio time at which the next chunk should begin. */
  private nextStartTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly context: AudioContext,
    /** Called once the last queued chunk has finished playing. */
    private readonly onDrained: () => void = () => {},
  ) {}

  /** True while audio is queued or playing. */
  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Queue one chunk of mono PCM16 to play after everything already queued. */
  enqueue(samples: Int16Array, sampleRate: number): void {
    if (samples.length === 0) return;

    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    // Restart the clock whenever the queue has run dry, otherwise a stale
    // `nextStartTime` in the past makes the browser play the chunk immediately
    // and every later chunk overlaps it.
    const now = this.context.currentTime;
    if (this.nextStartTime < now) this.nextStartTime = now + START_CUSHION_S;

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.scheduleDrainCheck();
    };
  }

  /** Stop and forget everything queued. */
  stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* never started, or already finished */
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
  }

  /**
   * Report "drained" only after the event loop has settled.
   *
   * Chunks finish one at a time, and the next socket frame usually arrives in
   * the same tick — announcing an empty queue immediately would unmute the
   * microphone between two halves of the same sentence.
   */
  private scheduleDrainCheck(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (this.sources.size === 0) this.onDrained();
    }, 60);
  }
}
