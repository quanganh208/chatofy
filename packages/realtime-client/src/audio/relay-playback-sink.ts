import type { LanguageCode } from '@chatofy/types';
import type { PlaybackSink } from './ordered-playback.js';

/**
 * Playback that happens somewhere other than this machine's loudspeakers.
 *
 * Two callers translate what the USER says and deliver it to other people: the
 * extension's outbound leg hands the samples to the meeting page, and a
 * conference speaker leg broadcasts them into the room. Neither can play them
 * here, so only the leaf moves. Turn order, the backlog ceiling and the stall
 * watchdog stay in `OrderedPlayback`, and that split is the point: the far side
 * is not trusted to decide when a turn is over.
 *
 * It SENDS ON ENQUEUE, as fast as the frames arrive — usually faster than real
 * time. Nothing here paces the audio; the receiving side's own queue does. Only
 * the drain bookkeeping is clock-based: a turn counts as playing until its audio
 * has had time to play out wherever it went. So `isPlaying` means "relayed and
 * not yet finished over there", never "sounding on this machine".
 *
 * A turn may carry several languages at once, each heard by different
 * listeners in parallel. Its hold is therefore the LONGEST language, not the
 * sum: the turn is drained once every one of its languages has passed its own
 * `startedAt + duration + SETTLE_MS`.
 */

/**
 * How long a turn is still counted as sounding after its samples should have run
 * out.
 *
 * The page could report when a turn finished, and an earlier version of this let
 * it. That hands whatever runs on that page the ability to retire a turn early,
 * which releases the next one over the top of the sentence still playing — the
 * interleaving defect this project has already shipped twice, reachable from
 * outside the extension. The clock answers instead, and the page is not asked.
 *
 * The margin covers the queue's own start cushion and the relay hop, and it errs
 * deliberately: counting a finished turn as still playing costs a moment of
 * delay, while the opposite costs two sentences on top of each other.
 */
const SETTLE_MS = 250;

/** Turns tracked at once. A key we never sent is a key we never retire. */
const MAX_TRACKED_TURNS = 64;

/** How often to look for turns whose audio has had time to finish. */
const WATCH_MS = 100;

interface Queued {
  /** Milliseconds of audio handed over for this turn in one language. */
  durationMs: number;
  /** When the first chunk of this language went out. */
  startedAt: number;
}

/** One turn's audio, by language; `''` is a frame that named none. */
type QueuedTurn = Map<string, Queued>;

export interface RelayPlaybackSinkDeps {
  /** Hand one chunk over. Called synchronously from `enqueue`, never deferred. */
  sendAudio: (
    turnKey: string,
    samples: Int16Array,
    sampleRate: number,
    lang?: LanguageCode,
  ) => void;
  /** The ordering layer abandoned this turn; the far side may drop what it holds of it. */
  sendDrop?: (turnKey: string) => void;
  /** Teardown: the far side may silence everything it holds. */
  sendSilence?: () => void;
  /**
   * A turn's audio has had time to finish.
   *
   * The ordering layer only re-examines its queue when something tells it to,
   * and on this path nothing else ever does: the far side is not asked, so there
   * is no drain callback arriving from anywhere. Without this the head turn is
   * never retired, the next one waits behind it, and the stall watchdog
   * eventually drops both — reporting a pipeline fault for audio that played
   * perfectly.
   */
  onTurnDrained?: (turnKey: string) => void;
  now?: () => number;
}

export class RelayPlaybackSink implements PlaybackSink {
  private readonly turns = new Map<string, QueuedTurn>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: RelayPlaybackSinkDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number, lang?: LanguageCode): void {
    if (samples.length === 0) return;
    const durationMs = (samples.length / sampleRate) * 1000;
    let turn = this.turns.get(turnKey);
    if (!turn) {
      turn = new Map();
      this.turns.set(turnKey, turn);
    }
    const key = lang ?? '';
    const existing = turn.get(key);
    if (existing) existing.durationMs += durationMs;
    else turn.set(key, { durationMs, startedAt: this.now() });
    this.forget();
    this.watch();

    this.deps.sendAudio(turnKey, samples, sampleRate, lang);
  }

  isPlayingTurn(turnKey: string): boolean {
    const turn = this.turns.get(turnKey);
    if (!turn) return false;
    if (this.expired(turn)) {
      this.turns.delete(turnKey);
      return false;
    }
    return true;
  }

  get isPlaying(): boolean {
    for (const [turnKey, turn] of this.turns) {
      if (this.expired(turn)) this.turns.delete(turnKey);
      else return true;
    }
    return false;
  }

  /** Drained only when EVERY language of the turn has had time to play out. */
  private expired(turn: QueuedTurn): boolean {
    const now = this.now();
    for (const queued of turn.values()) {
      if (now - queued.startedAt < queued.durationMs + SETTLE_MS) return false;
    }
    return true;
  }

  /**
   * Retire turns whose audio has had time to play, and say so.
   *
   * Runs only while something is queued. `isPlayingTurn` alone cannot carry this:
   * it is a question the ordering layer asks, and the ordering layer stops asking
   * once it is waiting on a head turn nobody has retired.
   */
  private watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const [turnKey, turn] of [...this.turns]) {
        if (!this.expired(turn)) continue;
        this.turns.delete(turnKey);
        this.deps.onTurnDrained?.(turnKey);
      }
      if (this.turns.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, WATCH_MS);
  }

  stop(): void {
    this.turns.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Tolerates having nowhere to send: teardown of a failed start runs through
    // this path before the far side has been told anything.
    this.deps.sendSilence?.();
  }

  stopTurn(turnKey: string): void {
    this.turns.delete(turnKey);
    this.deps.sendDrop?.(turnKey);
  }

  /** Bounded, because turn keys arrive from a long-lived conversation. */
  private forget(): void {
    while (this.turns.size > MAX_TRACKED_TURNS) {
      const oldest = this.turns.keys().next().value;
      if (oldest === undefined) break;
      this.turns.delete(oldest);
    }
  }
}
