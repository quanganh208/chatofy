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
 *
 * That measurement was taken with exactly ONE turn in flight, which is the thing
 * concurrent turns remove. With several turns sharing the sidecars, a clause can
 * finish playing before the next one has been synthesized, so the queue really
 * does run dry mid-turn. That is why every chunk now carries the turn it belongs
 * to and drain is reported per turn: a queue-level "empty" signal cannot tell
 * "turn A finished" from "turn A starved half way through", and a caller reading
 * the second as the first releases the next turn early and then plays the rest of
 * A behind it. Whether a turn is actually over is the caller's knowledge, not
 * this class's.
 */

/**
 * Cushion before the first chunk starts, absorbing jitter between socket
 * frames. Small enough not to register as delay, large enough that a late frame
 * does not underrun the clock.
 */
const START_CUSHION_S = 0.06;

/**
 * How long to wait after a turn's last source ends before reporting it empty.
 *
 * Chunks finish one at a time and the next socket frame usually arrives in the
 * same tick, so announcing immediately would report a turn drained between two
 * halves of the same sentence.
 */
const DRAIN_SETTLE_MS = 60;

export class PcmPlaybackQueue {
  /** Web Audio time at which the next chunk should begin. */
  private nextStartTime = 0;
  /** Live sources per turn, so "is this turn still sounding" is answerable. */
  private readonly sources = new Map<string, Set<AudioBufferSourceNode>>();
  private readonly drainTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly context: AudioContext,
    /**
     * Called once a turn's queued chunks have all finished playing.
     *
     * "Finished playing" only. It does NOT mean the turn is over — more audio for
     * it may still be in flight. The caller decides what to make of that by
     * combining it with whether the server has closed the turn.
     */
    private readonly onTurnDrained: (turnKey: string) => void = () => {},
    /**
     * Where the samples go. The loudspeakers unless told otherwise.
     *
     * The extension's outbound direction speaks the user's translation to the
     * OTHER participants, which means the samples have to land in the node
     * feeding the meeting's outgoing track rather than in this machine's output.
     * Scheduling is identical either way, and a second copy of it is what this
     * parameter exists to avoid.
     */
    private readonly destination: AudioNode = context.destination,
  ) {}

  /** True while any turn has audio queued or playing. */
  get isPlaying(): boolean {
    for (const set of this.sources.values()) {
      if (set.size > 0) return true;
    }
    return false;
  }

  /** True while this particular turn has audio queued or playing. */
  isPlayingTurn(turnKey: string): boolean {
    return (this.sources.get(turnKey)?.size ?? 0) > 0;
  }

  /**
   * Queue one chunk of mono PCM16 to play after everything already queued.
   *
   * `turnKey` names the turn the chunk belongs to. Chunks still play in the order
   * they are enqueued: putting them in the right order is the caller's job, and
   * doing it here would need knowledge of turn boundaries this class does not have.
   */
  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    if (samples.length === 0) return;

    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    // Restart the clock whenever the queue has run dry, otherwise a stale
    // `nextStartTime` in the past makes the browser play the chunk immediately
    // and every later chunk overlaps it.
    const now = this.context.currentTime;
    if (this.nextStartTime < now) this.nextStartTime = now + START_CUSHION_S;

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    // A chunk arriving for a turn with a drain report pending means the turn is
    // sounding again, so that report is stale and must not fire.
    this.clearDrainTimer(turnKey);

    let set = this.sources.get(turnKey);
    if (!set) {
      set = new Set();
      this.sources.set(turnKey, set);
    }
    set.add(source);

    source.onended = () => {
      set.delete(source);
      this.scheduleDrainCheck(turnKey);
    };
  }

  /** Stop and forget everything queued, for every turn. */
  stop(): void {
    for (const set of this.sources.values()) {
      for (const source of set) this.halt(source);
      set.clear();
    }
    this.sources.clear();
    this.nextStartTime = 0;
    for (const key of [...this.drainTimers.keys()]) this.clearDrainTimer(key);
  }

  /**
   * Stop and forget one turn's audio, leaving the others alone.
   *
   * For a turn abandoned while it still has audio queued — dropped at the backlog
   * ceiling above all.
   *
   * The schedule is rewound only when nothing is left to play. Chunks belonging to
   * other turns keep the start times they were given, so moving the clock back under
   * them would overlap them; but when the halted turn owned the tail of the schedule —
   * which it does whenever it was the one sounding — leaving `nextStartTime` out in the
   * future would make the next turn wait through the dead air of a turn nobody is
   * listening to any more.
   */
  stopTurn(turnKey: string): void {
    const set = this.sources.get(turnKey);
    if (!set) return;
    for (const source of set) this.halt(source);
    set.clear();
    this.sources.delete(turnKey);
    this.clearDrainTimer(turnKey);
    if (!this.isPlaying) this.nextStartTime = 0;
  }

  private halt(source: AudioBufferSourceNode): void {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* never started, or already finished */
    }
  }

  private clearDrainTimer(turnKey: string): void {
    const timer = this.drainTimers.get(turnKey);
    if (timer) clearTimeout(timer);
    this.drainTimers.delete(turnKey);
  }

  private scheduleDrainCheck(turnKey: string): void {
    this.clearDrainTimer(turnKey);
    this.drainTimers.set(
      turnKey,
      setTimeout(() => {
        this.drainTimers.delete(turnKey);
        if ((this.sources.get(turnKey)?.size ?? 0) === 0) {
          this.sources.delete(turnKey);
          this.onTurnDrained(turnKey);
        }
      }, DRAIN_SETTLE_MS),
    );
  }
}
