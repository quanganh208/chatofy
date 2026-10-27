/**
 * The listener side of subtitle turns: which line each remote speaker shows.
 *
 * Frames are cumulative per `turnId`, so the newest frame REPLACES the line.
 * A turn's final frame schedules the line to clear, and the clear is keyed to
 * that turn: if the speaker has started another turn by the time it fires, the
 * newer line stays.
 *
 * A speaker's turns can overlap — the cascade keeps up to three in flight — so
 * frames of an older turn keep arriving after a newer one has begun. Turns are
 * ranked by the order this listener first saw them, and once a newer turn is on
 * screen nothing of an older one replaces it: the line never jumps back. An
 * older turn's final still shows while the newer turn has no text yet, because
 * then it IS the latest thing said.
 *
 * A frame with no text on either channel is the speaker's clear: the turn ended
 * with no final. It takes that turn's line down, and nobody else's.
 */
import type { ConferenceTranslationSubtitle } from '@chatofy/types/events';

/** How long a finished line stays on screen. */
export const SUBTITLE_HOLD_MS = 4000;

/** Turns ranked per speaker. Far above the turns one speaker can have in flight. */
const MAX_RANKED_TURNS = 32;

export class PeerSubtitleTracker {
  /** speakerSocketId → the turn whose text is on screen. */
  private readonly activeTurn = new Map<string, string>();
  private readonly clearTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** speakerSocketId → turnId → rank, in first-seen order. */
  private readonly ranks = new Map<string, Map<string, number>>();
  private nextRank = 0;

  constructor(
    private readonly show: (speakerSocketId: string, text: string | undefined) => void,
    private readonly holdMs: number = SUBTITLE_HOLD_MS,
  ) {}

  /**
   * Take one frame. `listenerLanguage` picks the channel: a listener who speaks
   * the speaker's language reads what was said, everyone else the translation.
   */
  receive(subtitle: ConferenceTranslationSubtitle, listenerLanguage: string): void {
    const speaker = subtitle.speakerSocketId;
    if (!speaker) return;
    const rank = this.rankOf(speaker, subtitle.turnId);
    const active = this.activeTurn.get(speaker);

    if (!subtitle.isFinal && !subtitle.sourceText && !subtitle.translatedText) {
      if (active !== subtitle.turnId) return;
      this.cancelClear(speaker);
      this.activeTurn.delete(speaker);
      this.show(speaker, undefined);
      return;
    }

    const text =
      subtitle.sourceLanguage === listenerLanguage ? subtitle.sourceText : subtitle.translatedText;
    // A frame with nothing yet on this listener's channel shows nothing new; an
    // earlier turn's line stays rather than flashing to blank.
    if (!text) return;
    // An older turn than the one on screen: the line does not go back to it.
    if (active !== undefined && active !== subtitle.turnId && rank < this.rankOf(speaker, active)) {
      return;
    }

    this.cancelClear(speaker);
    this.activeTurn.set(speaker, subtitle.turnId);
    this.show(speaker, text);

    if (!subtitle.isFinal) return;
    const turnId = subtitle.turnId;
    this.clearTimers.set(
      speaker,
      setTimeout(() => {
        this.clearTimers.delete(speaker);
        if (this.activeTurn.get(speaker) !== turnId) return;
        this.activeTurn.delete(speaker);
        this.show(speaker, undefined);
      }, this.holdMs),
    );
  }

  /** The speaker left: drop its state without touching the display. */
  forget(speakerSocketId: string): void {
    this.cancelClear(speakerSocketId);
    this.activeTurn.delete(speakerSocketId);
    this.ranks.delete(speakerSocketId);
  }

  dispose(): void {
    for (const timer of this.clearTimers.values()) clearTimeout(timer);
    this.clearTimers.clear();
    this.activeTurn.clear();
    this.ranks.clear();
  }

  /** The turn's first-seen rank for this speaker, assigned on first sight. */
  private rankOf(speakerSocketId: string, turnId: string): number {
    let turns = this.ranks.get(speakerSocketId);
    if (!turns) {
      turns = new Map();
      this.ranks.set(speakerSocketId, turns);
    }
    const known = turns.get(turnId);
    if (known !== undefined) return known;
    const rank = this.nextRank++;
    turns.set(turnId, rank);
    // Oldest first; the turn on screen is never the oldest of 32 in practice.
    while (turns.size > MAX_RANKED_TURNS) {
      const oldest = turns.keys().next().value;
      if (oldest === undefined) break;
      turns.delete(oldest);
    }
    return rank;
  }

  private cancelClear(speakerSocketId: string): void {
    const timer = this.clearTimers.get(speakerSocketId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.clearTimers.delete(speakerSocketId);
  }
}
