/**
 * Who the meeting hears while the outbound direction is running.
 *
 * The rule the user asked for: while a capture is sending their translation into
 * the meeting, the other participants hear ONLY that translation. Their real
 * voice is held silent for the whole session, not merely ducked under each
 * sentence — two voices at once, five seconds apart, is not something anyone can
 * follow.
 *
 * That makes the extension responsible for a microphone it is holding shut, in a
 * page it does not control and cannot be told about its own death. An offscreen
 * document that crashes, is killed by Chrome, or is thrown away by a developer
 * reloading the extension would leave the user's microphone dead in a live
 * meeting, with the track live, unmuted, reporting a real device, and no way back
 * short of reloading the page — the exact failure `microphone-patch.ts` is
 * written to make impossible.
 *
 * So suppression is a LEASE rather than a switch. The offscreen document renews
 * it while it is sending; the page releases the voice on its own if a renewal
 * stops arriving. Nothing has to notice the crash, and the worst case is that the
 * user's own voice comes back — which is the direction this whole feature is
 * required to fail in.
 */

/** How often the offscreen document restates that it is still holding the voice. */
export const VOICE_RENEW_MS = 1000;

/**
 * How long the page keeps the voice down without hearing from the extension.
 *
 * Three renewals. One missed message is a busy main thread; three in a row is
 * something that is not coming back, and the cost of waiting longer is a user
 * talking into a meeting that cannot hear them.
 */
export const VOICE_LEASE_MS = 3 * VOICE_RENEW_MS;

export interface VoiceLeaseDeps {
  /** Called whenever the answer to "does the user's own voice go out" changes. */
  onChange: (mine: boolean) => void;
  setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * The page-world half: holds the voice down only while renewals keep arriving.
 */
export class VoiceLease {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = false;
  private readonly setTimer: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly deps: VoiceLeaseDeps) {
    this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** True while the user's own voice reaches the meeting. */
  get mine(): boolean {
    return !this.held;
  }

  /**
   * A renewal arrived: keep the user's voice down for another lease.
   *
   * Reported to the caller only on the edge. A renewal a second for the length of
   * a meeting must not become a gain ramp a second on every composed track.
   */
  renew(): void {
    this.arm();
    if (this.held) return;
    this.held = true;
    this.deps.onChange(false);
  }

  /** The extension said it is done, or the lease ran out. */
  release(): void {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.held) return;
    this.held = false;
    this.deps.onChange(true);
  }

  private arm(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.release();
    }, VOICE_LEASE_MS);
  }
}

export interface VoiceHoldDeps {
  send: (mine: boolean) => void;
  setInterval?: (run: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * The offscreen half: keeps renewing for as long as the session is sending.
 */
export class VoiceHold {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly start: (run: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly stop: (handle: ReturnType<typeof setInterval>) => void;

  constructor(private readonly deps: VoiceHoldDeps) {
    this.start = deps.setInterval ?? ((run, ms) => setInterval(run, ms));
    this.stop = deps.clearInterval ?? ((handle) => clearInterval(handle));
  }

  /** Begin holding the user's voice down, and keep saying so. */
  hold(): void {
    if (this.timer) return;
    this.deps.send(false);
    this.timer = this.start(() => this.deps.send(false), VOICE_RENEW_MS);
  }

  /**
   * Give the voice back, now rather than at the end of a lease.
   *
   * Idempotent: teardown runs through more than one path, and a second release
   * must not re-send after the channel has gone.
   */
  release(): void {
    if (!this.timer) return;
    this.stop(this.timer);
    this.timer = null;
    this.deps.send(true);
  }
}
