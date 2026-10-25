/**
 * The listener side of subtitle turns: which line each remote speaker shows.
 *
 * Frames are cumulative per `turnId`, so the newest frame REPLACES the line.
 * A turn's final frame schedules the line to clear, and the clear is keyed to
 * that turn: if the speaker has started another turn by the time it fires, the
 * newer line stays.
 */
import type { ConferenceTranslationSubtitle } from '@chatofy/types/events';

/** How long a finished line stays on screen. */
export const SUBTITLE_HOLD_MS = 4000;

export class PeerSubtitleTracker {
  /** speakerSocketId → the turn whose text is on screen. */
  private readonly activeTurn = new Map<string, string>();
  private readonly clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    const text =
      subtitle.sourceLanguage === listenerLanguage ? subtitle.sourceText : subtitle.translatedText;
    // A frame with nothing yet on this listener's channel shows nothing new; an
    // earlier turn's line stays rather than flashing to blank.
    if (!text) return;

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
  }

  dispose(): void {
    for (const timer of this.clearTimers.values()) clearTimeout(timer);
    this.clearTimers.clear();
    this.activeTurn.clear();
  }

  private cancelClear(speakerSocketId: string): void {
    const timer = this.clearTimers.get(speakerSocketId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.clearTimers.delete(speakerSocketId);
  }
}
