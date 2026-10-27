import {
  MAX_CONFERENCE_TURN_TEXT_CHARS,
  type ConferenceTranslationSubtitle,
  type LanguageCode,
  type ServerEvent,
} from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  turnKeyedTranscriptReducer,
  type LiveTurn,
} from '../state/turn-keyed-transcript.js';

/**
 * A speaker's translate-session events, turned into the subtitle frames a
 * conference room carries.
 *
 * The same reducer /translate draws its live lines with decides what a turn
 * says so far; this only watches it per server `sessionId` and reports changes.
 * One rule matters more than the rest: `isFinal: true` comes ONLY from
 * `server.transcript.final`, with the server's own text. The gateway persists
 * the first final frame of a turn and ignores the rest, so a final invented here
 * — on a client give-up, a hard stop, a dropped socket — would be the row that
 * is kept, with half a sentence or no translation in it.
 *
 * What closes a turn without a final emits a non-final CLEAR (empty text), so a
 * listener's line goes away and nothing is persisted.
 */

/** Turns tracked at once, open or recently closed. Oldest is forgotten first. */
const MAX_TRACKED_TURNS = 64;

export interface CascadeSubtitleRelayOptions {
  sourceLanguage: LanguageCode;
  /**
   * The language a turn's `translatedText` is in. Read once per turn, the first
   * time its session id is seen, and kept for every frame of it: the room can
   * change while the turn is spoken, and the server's partials stay in the
   * language the turn started in.
   */
  primary: (sessionId: string) => LanguageCode;
  emit: (subtitle: ConferenceTranslationSubtitle) => void;
  /** The number of turns with a live line changed. */
  onOpenTurnCountChange?: (count: number) => void;
}

const clip = (text: string): string => text.slice(0, MAX_CONFERENCE_TURN_TEXT_CHARS);

export class CascadeSubtitleRelay {
  /** Only live lines are kept; finished turns leave nothing behind here. */
  private state = initialTurnKeyedTranscript;
  /** What each open turn last relayed, so an unchanged line is not sent twice. */
  private readonly open = new Map<string, string>();
  /** Turns that are over. Later events for them are ignored. */
  private readonly closed = new Set<string>();
  /** Each live turn's primary, read at first sight; see the `primary` option. */
  private readonly primaries = new Map<string, LanguageCode>();

  constructor(private readonly options: CascadeSubtitleRelayOptions) {}

  /** Turns with a line on listeners' screens right now. */
  get openTurnCount(): number {
    return this.open.size;
  }

  handle(event: ServerEvent): void {
    const sessionId = 'sessionId' in event ? event.sessionId : undefined;
    if (sessionId !== undefined && this.closed.has(sessionId)) return;
    if (sessionId !== undefined) this.primaryOf(sessionId);

    const next = turnKeyedTranscriptReducer(this.state, event);
    // Bounded: everything but the live lines would otherwise grow for the
    // length of the meeting, and nothing here reads it.
    this.state = { ...initialTurnKeyedTranscript, live: next.live };
    if (sessionId === undefined) return;

    if (event.type === 'server.transcript.final') {
      this.finalize(sessionId, event.segment.sourceText, event.segment.translations);
      return;
    }
    if (event.type === 'server.session.ended') {
      // Normally after its final, which already closed it. Reaching here open
      // means the line vanished with no final: no speech, or a failure.
      this.close(sessionId);
      return;
    }

    const live = next.live[sessionId];
    if (live) this.relayLive(sessionId, live);
    // A turn-scoped error clears the line. The turn is not closed for it: only
    // its final or its `server.session.ended` does that, so a final that still
    // comes is relayed.
    else if (this.open.has(sessionId)) this.close(sessionId, false);
  }

  /**
   * Clear every open turn without persisting anything.
   *
   * For a leg that stops or loses its translate socket: those turns' finals will
   * never arrive over this session, and a final made up here would be persisted.
   */
  closeOpen(): void {
    for (const sessionId of [...this.open.keys()]) this.close(sessionId);
    this.state = initialTurnKeyedTranscript;
    this.primaries.clear();
  }

  /** The turn's primary, snapshotted the first time it is asked for. */
  private primaryOf(sessionId: string): LanguageCode {
    const known = this.primaries.get(sessionId);
    if (known !== undefined) return known;
    const primary = this.options.primary(sessionId);
    this.primaries.set(sessionId, primary);
    // Twice the open bound: turns seen but not yet showing a line count too,
    // and an open turn's snapshot must outlive them.
    while (this.primaries.size > 2 * MAX_TRACKED_TURNS) {
      const oldest = this.primaries.keys().next().value;
      if (oldest === undefined) break;
      this.primaries.delete(oldest);
    }
    return primary;
  }

  private relayLive(sessionId: string, live: LiveTurn): void {
    const sourceText = clip(live.text);
    const translatedText = clip(live.translation);
    const fingerprint = `${sourceText}\u0000${translatedText}`;
    if (this.open.get(sessionId) === fingerprint) return;
    const opened = !this.open.has(sessionId);
    this.open.delete(sessionId);
    this.open.set(sessionId, fingerprint);
    this.evict();
    const primary = this.primaryOf(sessionId);
    this.options.emit({
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: primary,
      sourceText,
      translatedText,
      translations: { [primary]: translatedText },
      isFinal: false,
      turnId: sessionId,
    });
    if (opened) this.countChanged();
  }

  private finalize(
    sessionId: string,
    sourceText: string,
    translations: Partial<Record<LanguageCode, string>>,
  ): void {
    const primary = this.primaryOf(sessionId);
    const clipped: Partial<Record<LanguageCode, string>> = {};
    for (const [lang, text] of Object.entries(translations) as [LanguageCode, string][]) {
      clipped[lang] = clip(text);
    }
    const wasOpen = this.open.delete(sessionId);
    this.markClosed(sessionId);
    this.options.emit({
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: primary,
      sourceText: clip(sourceText),
      translatedText: clipped[primary] ?? '',
      translations: clipped,
      isFinal: true,
      turnId: sessionId,
    });
    if (wasOpen) this.countChanged();
  }

  /**
   * End a turn's line with no final: a non-final clear if listeners saw any of
   * it. `forget` also ignores everything said about the turn from here on.
   */
  private close(sessionId: string, forget = true): void {
    const wasOpen = this.open.delete(sessionId);
    // Read before `markClosed` forgets it, or the clear would ask the room again.
    const primary = wasOpen ? this.primaryOf(sessionId) : undefined;
    if (forget) this.markClosed(sessionId);
    if (primary === undefined) return;
    this.options.emit({
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: primary,
      sourceText: '',
      translatedText: '',
      isFinal: false,
      turnId: sessionId,
    });
    this.countChanged();
  }

  private markClosed(sessionId: string): void {
    this.primaries.delete(sessionId);
    this.closed.add(sessionId);
    while (this.closed.size > MAX_TRACKED_TURNS) {
      const oldest = this.closed.values().next().value;
      if (oldest === undefined) break;
      this.closed.delete(oldest);
    }
  }

  /** Open turns are bounded too; the oldest is cleared, never finalized. */
  private evict(): void {
    while (this.open.size > MAX_TRACKED_TURNS) {
      const oldest = this.open.keys().next().value;
      if (oldest === undefined) break;
      this.close(oldest);
    }
  }

  private countChanged(): void {
    this.options.onOpenTurnCountChange?.(this.open.size);
  }
}
