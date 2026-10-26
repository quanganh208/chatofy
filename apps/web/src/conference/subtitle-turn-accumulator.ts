/**
 * Turns the live translate stream into subtitle turns for the room.
 *
 * `/ws/translate` in live mode emits text deltas on two channels — `source`
 * (what was heard) and `target` (its translation) — and no utterance boundary
 * at all. The room needs turns: one id per utterance, carrying the text heard
 * and translated SO FAR, closed exactly once. So the speaker's client decides
 * where a turn ends: a quiet gap with no delta on either channel.
 *
 * Every delta produces one cumulative `isFinal: false` frame; the gap produces
 * one `isFinal: true` frame with the same texts, which is the only frame the
 * gateway persists. The next delta opens a fresh turn id.
 */
import { MAX_CONFERENCE_TURN_TEXT_CHARS } from '@chatofy/types/events';

/** Quiet time, on both channels, that closes the current turn. */
export const TURN_QUIET_GAP_MS = 1500;

export interface SubtitleTurnFrame {
  turnId: string;
  sourceText: string;
  translatedText: string;
  isFinal: boolean;
}

export interface SubtitleTurnAccumulatorOptions {
  onFrame: (frame: SubtitleTurnFrame) => void;
  /** True while a turn is open, false once it closes. Fires on change only. */
  onTurnOpenChange?: (open: boolean) => void;
  quietGapMs?: number;
  newTurnId?: () => string;
  maxChars?: number;
}

interface OpenTurn {
  turnId: string;
  sourceText: string;
  translatedText: string;
}

export class SubtitleTurnAccumulator {
  private turn: OpenTurn | null = null;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly quietGapMs: number;
  private readonly newTurnId: () => string;
  private readonly maxChars: number;

  constructor(private readonly options: SubtitleTurnAccumulatorOptions) {
    this.quietGapMs = options.quietGapMs ?? TURN_QUIET_GAP_MS;
    this.newTurnId = options.newTurnId ?? (() => crypto.randomUUID());
    this.maxChars = options.maxChars ?? MAX_CONFERENCE_TURN_TEXT_CHARS;
  }

  /** Add one delta from the live stream. Empty deltas carry nothing and are ignored. */
  push(channel: 'source' | 'target', delta: string): void {
    if (!delta) return;
    const field = channel === 'source' ? 'sourceText' : 'translatedText';

    // A turn that would outgrow the wire's per-turn cap is closed first, so the
    // overflow starts the next turn instead of being refused by the gateway.
    if (this.turn && this.turn[field].length + delta.length > this.maxChars) this.close();

    if (!this.turn) {
      this.turn = { turnId: this.newTurnId(), sourceText: '', translatedText: '' };
      this.options.onTurnOpenChange?.(true);
    }
    this.turn[field] = (this.turn[field] + delta).slice(0, this.maxChars);
    this.emit(false);
    this.armQuietTimer();
  }

  /** Close the open turn now, as the quiet gap would have. No-op when none is open. */
  close(): void {
    this.cancelQuietTimer();
    if (!this.turn) return;
    this.emit(true);
    this.turn = null;
    this.options.onTurnOpenChange?.(false);
  }

  private emit(isFinal: boolean): void {
    if (!this.turn) return;
    this.options.onFrame({ ...this.turn, isFinal });
  }

  private armQuietTimer(): void {
    this.cancelQuietTimer();
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.close();
    }, this.quietGapMs);
  }

  private cancelQuietTimer(): void {
    if (this.quietTimer === null) return;
    clearTimeout(this.quietTimer);
    this.quietTimer = null;
  }
}
