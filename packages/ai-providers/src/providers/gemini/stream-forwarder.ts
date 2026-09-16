import { stripTranscriptTags } from './prompt-builder.js';

/**
 * Hands a streamed translation to a caller as it arrives, safely.
 *
 * Two rules, and both exist because something on this path was observed going
 * wrong rather than because they seemed prudent.
 *
 * **Strip before forwarding.** A model on this path returns the prompt's
 * wrapper tag verbatim on some inputs — `prompt-builder.ts` documents the
 * measurement. The provider has always stripped it from the finished text; a
 * stream that forwarded raw chunks would put it on screen on the way past.
 *
 * **Hold back an unclosed `<`.** The strip pattern matches a whole tag, so half
 * of one split across two chunks does not match yet, and `<transcr` would be
 * forwarded as ordinary text. The event this feeds only ever APPENDS, so
 * nothing forwarded can be taken back. Holding the tail costs nothing: the
 * finished result carries it, and the caller replaces the line with that.
 */
export class StreamForwarder {
  /** Length of the CLEANED text already handed over. */
  private forwarded = 0;

  constructor(private readonly onChunk: (delta: string, restart: boolean) => void) {}

  /**
   * Take the raw text accumulated so far and emit whatever is now safe to show.
   *
   * Takes the accumulated string rather than the newest chunk because stripping
   * is not a per-chunk operation: a tag spanning a chunk boundary only
   * disappears once both halves are in hand.
   */
  push(rawSoFar: string): void {
    const clean = stripTranscriptTags(rawSoFar);
    const opened = clean.lastIndexOf('<');
    const safe = opened > clean.lastIndexOf('>') ? opened : clean.length;
    if (safe <= this.forwarded) return;
    // `restart` on the first emission of this forwarder's life: one forwarder
    // belongs to one attempt, and a caller told to restart discards whatever an
    // abandoned attempt had already shown it.
    this.onChunk(clean.slice(this.forwarded, safe), this.forwarded === 0);
    this.forwarded = safe;
  }
}
