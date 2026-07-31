import { pcm16ToBase64, type PlaybackSink } from '@chatofy/realtime-client';
import type { OutboundCommand } from './outbound-channel';

/**
 * Playback that happens in the meeting page instead of on this machine.
 *
 * The outbound direction translates what the USER says and has to deliver it to
 * the other participants. Their outgoing audio lives in the page, and a
 * `MediaStream` cannot cross into it, so the samples travel as base64 and the
 * page schedules them into the track the meeting client is transmitting.
 *
 * Only the leaf moves. Turn order, the backlog ceiling and the stall watchdog
 * stay in `OrderedPlayback` here, and that split is the point: the page is not
 * trusted to decide when a turn is over.
 *
 * Base64 rather than a typed array because `chrome.runtime` messages are JSON —
 * an `Int16Array` arrives as an object with numeric keys.
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
  /** Milliseconds of audio handed over for this turn. */
  durationMs: number;
  /** When the first chunk went out, so elapsed time can be compared to it. */
  startedAt: number;
}

export interface PagePlaybackSinkDeps {
  send: (command: OutboundCommand) => void;
  /**
   * A turn's audio has had time to finish.
   *
   * The ordering layer only re-examines its queue when something tells it to,
   * and on this path nothing else ever does: the page is not asked, so there is
   * no drain callback arriving from anywhere. Without this the head turn is
   * never retired, the next one waits behind it, and the stall watchdog
   * eventually drops both — reporting a pipeline fault for audio that played
   * perfectly.
   */
  onTurnDrained?: (turnKey: string) => void;
  now?: () => number;
}

export class PagePlaybackSink implements PlaybackSink {
  private readonly turns = new Map<string, Queued>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: PagePlaybackSinkDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    if (samples.length === 0) return;
    const durationMs = (samples.length / sampleRate) * 1000;
    const existing = this.turns.get(turnKey);
    if (existing) existing.durationMs += durationMs;
    else this.turns.set(turnKey, { durationMs, startedAt: this.now() });
    this.forget();
    this.watch();

    this.deps.send({
      type: 'chatofy:audio',
      turnKey,
      payload: pcm16ToBase64(samples),
      sampleRate,
    });
  }

  isPlayingTurn(turnKey: string): boolean {
    const queued = this.turns.get(turnKey);
    if (!queued) return false;
    if (this.expired(queued)) {
      this.turns.delete(turnKey);
      return false;
    }
    return true;
  }

  get isPlaying(): boolean {
    for (const [turnKey, queued] of this.turns) {
      if (this.expired(queued)) this.turns.delete(turnKey);
      else return true;
    }
    return false;
  }

  private expired(queued: Queued): boolean {
    return this.now() - queued.startedAt >= queued.durationMs + SETTLE_MS;
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
      for (const [turnKey, queued] of [...this.turns]) {
        if (!this.expired(queued)) continue;
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
    // this path before any tab has been told anything.
    this.deps.send({ type: 'chatofy:silence' });
  }

  stopTurn(turnKey: string): void {
    this.turns.delete(turnKey);
    this.deps.send({ type: 'chatofy:drop', turnKey });
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
