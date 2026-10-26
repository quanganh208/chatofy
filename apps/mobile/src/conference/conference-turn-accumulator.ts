/**
 * Groups the live translate stream's transcript deltas into turns.
 *
 * `/ws/translate` streams `source`- and `target`-channel deltas with no utterance
 * boundary. A turn opens on the first delta after a quiet spell; every delta then
 * emits the turn's ACCUMULATED texts as a provisional frame, and once
 * {@link TURN_QUIET_GAP_MS} pass with no delta on either channel the turn emits
 * one closing frame with `isFinal: true`. The next delta opens a fresh turn with a
 * new id. Listeners replace by `turnId`, and the gateway persists only the
 * closing frame, so one spoken utterance is one subtitle line and one stored row.
 *
 * Pure (no React Native, no sockets); the timer is injectable for tests.
 */

import { MAX_CONFERENCE_TURN_TEXT_CHARS } from '@chatofy/types/events';

/** Silence on both channels after which the open turn closes. */
export const TURN_QUIET_GAP_MS = 1500;

export type TranscriptChannel = 'source' | 'target';

export interface TurnFrame {
  turnId: string;
  /** Source-channel text heard so far in this turn. */
  sourceText: string;
  /** Target-channel text translated so far in this turn. */
  translatedText: string;
  isFinal: boolean;
}

export interface TurnTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface TurnAccumulatorOptions {
  /** Mints the id of each new turn. */
  newTurnId: () => string;
  /** Receives every provisional frame and each turn's single closing frame. */
  emit: (frame: TurnFrame) => void;
  /** Called when a turn opens (`true`) and when it closes (`false`). */
  onTurnActive?: (active: boolean) => void;
  quietGapMs?: number;
  /** Longest text either channel may accumulate before the turn is closed early. */
  maxTextChars?: number;
  timers?: TurnTimers;
}

interface OpenTurn {
  turnId: string;
  sourceText: string;
  translatedText: string;
}

const defaultTimers: TurnTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TurnAccumulator {
  private turn: OpenTurn | null = null;
  private quietTimer: unknown = null;
  private readonly quietGapMs: number;
  private readonly maxTextChars: number;
  private readonly timers: TurnTimers;
  private readonly options: TurnAccumulatorOptions;

  constructor(options: TurnAccumulatorOptions) {
    this.options = options;
    this.quietGapMs = options.quietGapMs ?? TURN_QUIET_GAP_MS;
    this.maxTextChars = options.maxTextChars ?? MAX_CONFERENCE_TURN_TEXT_CHARS;
    this.timers = options.timers ?? defaultTimers;
  }

  /** True while a turn is open (a delta arrived and the quiet gap has not elapsed). */
  get active(): boolean {
    return this.turn !== null;
  }

  /** Add one transcript delta to the open turn (opening one if needed). */
  push(channel: TranscriptChannel, delta: string): void {
    if (delta.length === 0) return;

    // A turn whose text would outgrow the wire cap closes now and the delta
    // starts the next one, rather than producing a frame the gateway refuses.
    if (this.turn && this.lengthAfter(this.turn, channel, delta) > this.maxTextChars) {
      this.close();
    }

    if (!this.turn) {
      this.turn = { turnId: this.options.newTurnId(), sourceText: '', translatedText: '' };
      this.options.onTurnActive?.(true);
    }

    const turn = this.turn;
    if (channel === 'source') {
      turn.sourceText = (turn.sourceText + delta).slice(0, this.maxTextChars);
    } else {
      turn.translatedText = (turn.translatedText + delta).slice(0, this.maxTextChars);
    }

    this.options.emit({ ...turn, isFinal: false });
    this.armQuietTimer();
  }

  /** Close the open turn now (mute, session end, leave). No-op when none is open. */
  close(): void {
    this.cancelQuietTimer();
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    this.options.emit({ ...turn, isFinal: true });
    this.options.onTurnActive?.(false);
  }

  /** Drop any open turn without emitting (the socket it would go to is gone). */
  dispose(): void {
    this.cancelQuietTimer();
    if (this.turn) {
      this.turn = null;
      this.options.onTurnActive?.(false);
    }
  }

  private lengthAfter(turn: OpenTurn, channel: TranscriptChannel, delta: string): number {
    const current = channel === 'source' ? turn.sourceText : turn.translatedText;
    return current.length + delta.length;
  }

  private armQuietTimer(): void {
    this.cancelQuietTimer();
    this.quietTimer = this.timers.set(() => {
      this.quietTimer = null;
      this.close();
    }, this.quietGapMs);
  }

  private cancelQuietTimer(): void {
    if (this.quietTimer !== null) {
      this.timers.clear(this.quietTimer);
      this.quietTimer = null;
    }
  }
}
