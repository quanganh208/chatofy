import type { LanguageCode } from '@chatofy/types';

/**
 * The `sequence` a speaker leg stamps on its relayed audio, one counter per
 * language, each starting at 0.
 *
 * Owned by the leg, never by a translate session: a leg rebuilds its session
 * when the translate socket drops, and a listener's resequencer orders frames by
 * this number per speaker and language. A counter that restarted with the
 * session would send 0 again to a listener already waiting for 412, and that
 * listener would hold or drop every frame after it.
 */
export class LegSequenceCounter {
  private readonly counters = new Map<LanguageCode, number>();

  next(lang: LanguageCode): number {
    const value = this.counters.get(lang) ?? 0;
    this.counters.set(lang, value + 1);
    return value;
  }
}
