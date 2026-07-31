/**
 * Turns a signal down while a translation is being spoken.
 *
 * Free, structurally, for the meeting's own audio: `tabCapture` mutes the tab and
 * forces the extension to play the original back itself, so that audio
 * necessarily passes through a node we own — and a gain node placed there is the
 * whole mechanism. Nothing has to be intercepted or patched.
 *
 * The user's outbound microphone needs the same ramp for a different reason, so
 * the gain it drops to is a parameter. Everything else — the ramp that keeps a
 * step from clicking, and the release that keeps a queue running dry mid-sentence
 * from swelling the signal back up — is identical, and two copies of it would
 * drift.
 */

/** How far the meeting's audio drops while a translation plays. Audible, not silent. */
const DUCKED_GAIN = 0.2;
const NORMAL_GAIN = 1;

/**
 * Ramp constant for `setTargetAtTime`.
 *
 * A ramp rather than an assignment: setting `gain.value` directly steps the
 * waveform, and a step in a signal is a click. 40ms is fast enough to get out of the
 * way of the first translated word and slow enough to be inaudible as a transition.
 */
const RAMP_S = 0.04;

/**
 * How long the original stays ducked after playback reports itself idle.
 *
 * Playback can run dry between two clauses of one turn — the measurement saying a
 * clause always outlasts the next one's synthesis was taken with a single turn in
 * flight, which concurrency removes. Restoring gain the instant the queue empties
 * would swell the meeting's audio back up inside a sentence and duck it again a
 * moment later.
 */
const RELEASE_MS = 250;

export class DuckController {
  private readonly gain: GainNode;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private ducked = false;

  constructor(
    private readonly context: AudioContext,
    /**
     * Where the gain goes while busy. Defaults to the meeting's duck level.
     *
     * The microphone gate passes 0: it is not making the user quieter, it is
     * making sure the speech gate downstream sees nothing at all, and anything
     * above zero would still open a turn on our own loudspeaker.
     */
    private readonly busyGain: number = DUCKED_GAIN,
  ) {
    this.gain = context.createGain();
    this.gain.gain.value = NORMAL_GAIN;
  }

  /** Insert the gain stage between the tab's audio and the speakers. */
  connect(source: AudioNode, destination: AudioNode): void {
    source.connect(this.gain);
    this.gain.connect(destination);
  }

  /**
   * Follow the playback layer's own idea of whether it is busy.
   *
   * `busy` must come from `OrderedPlayback.isBusy` — which counts turns still
   * waiting, not merely audio currently sounding. Driving this from "is a sample
   * playing" instead has a specific failure: with a growing backlog something is
   * always about to sound, so the original would stay ducked for the whole meeting
   * and the person running it would hear everyone else at a fifth of their volume
   * with no idea why.
   *
   * Idle is therefore honoured through a release delay, and busy immediately.
   */
  setBusy(busy: boolean): void {
    if (busy) {
      this.clearRelease();
      this.apply(this.busyGain);
      return;
    }
    if (!this.ducked || this.releaseTimer) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      this.apply(NORMAL_GAIN);
    }, RELEASE_MS);
  }

  /** Give the original its volume back and stop watching. */
  release(): void {
    this.clearRelease();
    this.apply(NORMAL_GAIN);
  }

  disconnect(): void {
    this.clearRelease();
    this.gain.disconnect();
  }

  /** For a status readout: is the meeting currently quietened. */
  get isDucked(): boolean {
    return this.ducked;
  }

  private apply(value: number): void {
    this.ducked = value !== NORMAL_GAIN;
    const now = this.context.currentTime;
    this.gain.gain.setTargetAtTime(value, now, RAMP_S);
    // `setTargetAtTime` approaches its target and never arrives: five time
    // constants leaves ~0.7% through. For the meeting's duck that is inaudible
    // and irrelevant, but the microphone gate's whole claim is that the speech
    // gate downstream sees NOTHING, and 0.7% of a loudspeaker is not nothing.
    // Pinning after the ramp keeps the curve and ends at the value asked for.
    if (value === 0) this.gain.gain.setValueAtTime(0, now + RAMP_S * 5);
  }

  private clearRelease(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }
}
