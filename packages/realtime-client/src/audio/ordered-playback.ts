/**
 * What this class needs from a playback queue, and nothing more.
 *
 * Stated as an interface rather than taking `PcmPlaybackQueue` directly, because
 * `isPlayingTurn` is the whole reason the queue changed: it is what separates
 * "turn A finished" from "turn A starved between two clauses". Naming the
 * dependency makes that requirement visible, and lets a test drive the distinction
 * directly instead of trying to provoke real starvation out of the Web Audio clock.
 *
 * {@link PcmPlaybackQueue} satisfies it structurally.
 */
export interface PlaybackSink {
  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void;
  isPlayingTurn(turnKey: string): boolean;
  readonly isPlaying: boolean;
  stop(): void;
  stopTurn(turnKey: string): void;
}

/**
 * Plays turns back in the order they were spoken, whatever order they finish in.
 *
 * The failure this exists to prevent: turn A runs 8s, turn B starts after it and
 * runs 2s. B goes through the pipeline faster, so its audio frames arrive first,
 * and `PcmPlaybackQueue` schedules by arrival — so the listener hears the second
 * sentence before the first. Both sentences are intact and every gate is green.
 *
 * This is the class of defect that has twice reached `main` in this project with
 * everything passing, so the tests for it are written to be provably failable:
 * removing the ordering must break them, and removing the per-turn drain token
 * must break a different one.
 *
 * Only the oldest incomplete turn — the head — is allowed to reach the queue.
 * Everything behind it buffers. A single loudspeaker plays one thing at a time
 * anyway, so there is nothing to gain from releasing more than one and everything
 * to lose.
 */

/**
 * How long the head may go without any sign of ending before it is released by
 * force.
 *
 * A stuck turn is a hang, not a wrong answer, which makes it far harder to notice
 * than audio in the wrong order: nothing throws, the app simply goes quiet
 * forever. Every signal that should complete a turn — ended, error, refusal —
 * travels over a socket that can drop one, so the timeout is the backstop and
 * every firing is logged.
 */
const TURN_STALL_TIMEOUT_MS = 15_000;

/**
 * Translated audio that may wait behind the head before turns start being dropped.
 *
 * "No sentence is lost" is bounded, not absolute, and the arithmetic says so:
 * playing turns back to back while capturing continuously means utilisation is
 * already ~100% before any overhead, so one turn hitting the p95 tail (measured
 * here: 1947ms, worst 8943ms) pushes every later turn back and the queue never
 * catches up. Something has to give, and it is better for it to be counted than
 * silent.
 */
const MAX_BACKLOG_MS = 12_000;

/** Turns that may be held behind the head, however short each one is. */
const MAX_HELD_TURNS = 6;

interface HeldFrame {
  samples: Int16Array;
  sampleRate: number;
}

interface Turn {
  readonly key: string;
  /** Position in speaking order, assigned at {@link OrderedPlayback.open}. */
  readonly order: number;
  frames: HeldFrame[];
  /** Milliseconds of audio buffered for this turn. */
  bufferedMs: number;
  /** The server has closed this turn: no further audio is coming. */
  ended: boolean;
  /** This turn's frames are going to the queue. */
  released: boolean;
}

export interface OrderedPlaybackHandlers {
  /** A turn was abandoned. `reason` says why, and every one of these is counted. */
  onDropped?: (turnKey: string, reason: 'backlog' | 'stalled') => void;
  /** The head changed, or playback fell idle. For status and ducking. */
  onPlayingChanged?: (playing: boolean) => void;
  /** Diagnostics that must never be silent. */
  onLog?: (message: string) => void;
}

export class OrderedPlayback {
  private readonly turns = new Map<string, Turn>();
  private nextOrder = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  /** The key the stall timer is currently watching, so it is never misattributed. */
  private stallWatching: string | null = null;
  private wasPlaying = false;

  constructor(
    private readonly queue: PlaybackSink,
    private readonly handlers: OrderedPlaybackHandlers = {},
  ) {}

  /**
   * Claim this turn's place in speaking order.
   *
   * Called when the turn OPENS, not when its audio arrives — the order has to come
   * from when someone started speaking, which is the one thing arrival order does
   * not tell you.
   */
  open(turnKey: string): void {
    if (this.turns.has(turnKey)) return;
    this.turns.set(turnKey, {
      key: turnKey,
      order: this.nextOrder++,
      frames: [],
      bufferedMs: 0,
      ended: false,
      released: false,
    });
    this.pump();
  }

  /** Audio arrived for a turn. Played now if it is the head, held otherwise. */
  push(turnKey: string, samples: Int16Array, sampleRate: number): void {
    const turn = this.turns.get(turnKey);
    // A turn that was dropped, or one that never opened, has nowhere to play. Its
    // audio is discarded rather than played out of order.
    if (!turn) return;

    if (turn.released) {
      this.queue.enqueue(turnKey, samples, sampleRate);
      this.reportPlaying();
      return;
    }

    turn.frames.push({ samples, sampleRate });
    turn.bufferedMs += (samples.length / sampleRate) * 1000;
    this.enforceBacklog();
  }

  /**
   * The server has closed this turn, whichever way it ended.
   *
   * Must be called for EVERY termination — a normal ending, a turn-level error,
   * and a refusal that never had a session id at all. A turn that ends with no
   * audio still has to release the turns behind it, and the refusal path is the
   * one most easily forgotten: it is identifiable only by the client's own turn
   * id, because the server had not assigned one yet.
   */
  finish(turnKey: string): void {
    const turn = this.turns.get(turnKey);
    if (!turn) return;
    turn.ended = true;
    this.pump();
  }

  /** Abandon a turn and anything queued for it. */
  drop(turnKey: string, reason: 'backlog' | 'stalled'): void {
    const turn = this.turns.get(turnKey);
    if (!turn) return;
    this.turns.delete(turnKey);
    this.queue.stopTurn(turnKey);
    this.handlers.onDropped?.(turnKey, reason);
    this.handlers.onLog?.(
      `dropped turn ${turnKey} (${reason}): ${Math.round(turn.bufferedMs)}ms of audio discarded`,
    );
    this.pump();
  }

  /**
   * Called by the queue when a turn's audio has all finished playing.
   *
   * The turn is not named in the body on purpose: what matters is only that
   * something finished, and `pump` re-derives the head and asks the queue directly
   * whether it is still sounding. Acting on the key here would mean trusting a
   * drain report to identify the turn it completes, which is the mistake this
   * class exists to prevent.
   */
  onTurnDrained(_turnKey: string): void {
    // Deliberately does NOT complete the turn on its own. A drained queue means
    // "nothing sounding right now", which for a turn still open means it starved
    // between two clauses — a real event once several turns share the sidecars,
    // because the measurement that said a clause always outlasts the next one's
    // synthesis was taken with a single turn in flight. Treating starvation as
    // completion releases the next turn and then plays the rest of this one
    // behind it, which is the exact defect this class exists to prevent.
    this.pump();
    this.reportPlaying();
  }

  /** Audio waiting behind the head, in milliseconds. */
  get backlogMs(): number {
    let total = 0;
    for (const turn of this.turns.values()) {
      if (!turn.released) total += turn.bufferedMs;
    }
    return total;
  }

  /** True while anything is sounding or waiting. Drives ducking and status. */
  get isBusy(): boolean {
    return this.queue.isPlaying || this.turns.size > 0;
  }

  /** Turns known but not yet finished playing. */
  get heldTurns(): number {
    return this.turns.size;
  }

  stop(): void {
    this.clearStallTimer();
    this.turns.clear();
    this.queue.stop();
    this.reportPlaying();
  }

  /** The oldest turn that has not finished, or undefined when all is played out. */
  private head(): Turn | undefined {
    let head: Turn | undefined;
    for (const turn of this.turns.values()) {
      if (!head || turn.order < head.order) head = turn;
    }
    return head;
  }

  /**
   * Release the head if it is due, and retire it when it is done.
   *
   * A loop rather than a single step: a run of turns that all ended without audio
   * — three refusals in a row at the concurrency ceiling — must all retire in one
   * go, or the queue advances one turn per event and stalls behind the first.
   */
  private pump(): void {
    for (;;) {
      const head = this.head();
      if (!head) break;

      if (!head.released) {
        head.released = true;
        const frames = head.frames;
        head.frames = [];
        head.bufferedMs = 0;
        for (const frame of frames) {
          this.queue.enqueue(head.key, frame.samples, frame.sampleRate);
        }
      }

      // Done only when the server has closed it AND its audio has played out.
      // Either condition alone is wrong: not-ended means more audio is coming,
      // and still-sounding means the listener is mid-sentence.
      const done = head.ended && !this.queue.isPlayingTurn(head.key);
      if (!done) {
        this.watchForStall(head.key);
        return;
      }

      this.turns.delete(head.key);
    }

    this.clearStallTimer();
    this.reportPlaying();
  }

  private watchForStall(turnKey: string): void {
    if (this.stallWatching === turnKey && this.stallTimer) return;
    this.clearStallTimer();
    this.stallWatching = turnKey;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.stallWatching = null;
      // Logged inside drop(). A silent forced release would turn a lost socket
      // event into a permanent, unexplained gap in the conversation.
      this.drop(turnKey, 'stalled');
    }, TURN_STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    this.stallWatching = null;
  }

  /**
   * Drop the oldest waiting turn until the backlog is back inside its ceiling.
   *
   * Dropping the OLDEST unplayed turn is a decision about what the listener is
   * for, not a technical default: in a conversation, what was said three seconds
   * ago has already lost its value, so hearing the newest thing beats hearing all
   * of it. Playing faster, and dropping the newest instead, were both considered
   * and rejected. Do not quietly reverse this.
   *
   * The head is never dropped here. It is either sounding right now — cutting it
   * off mid-word is worse than any backlog — or it is the turn the stall watchdog
   * is responsible for.
   */
  private enforceBacklog(): void {
    for (;;) {
      const overAudio = this.backlogMs > MAX_BACKLOG_MS;
      const overCount = this.heldTurns > MAX_HELD_TURNS;
      if (!overAudio && !overCount) return;

      const head = this.head();
      const oldestWaiting = [...this.turns.values()]
        .filter((turn) => !turn.released && turn.key !== head?.key)
        .sort((a, b) => a.order - b.order)[0];

      // Only the head is left. Nothing may be dropped, and the watchdog owns it.
      if (!oldestWaiting) return;
      this.drop(oldestWaiting.key, 'backlog');
    }
  }

  private reportPlaying(): void {
    const playing = this.isBusy;
    if (playing === this.wasPlaying) return;
    this.wasPlaying = playing;
    this.handlers.onPlayingChanged?.(playing);
  }
}
