/**
 * Which of a speaker's overlapping turns may hold that speaker's subtitle line.
 *
 * A cascade speaker can have several turns in flight at once: the next sentence
 * is already transcribing while the last one is still translated and spoken, and
 * their frames interleave. Showing whichever frame came last would flick the
 * line back and forth between sentences. So, per speaker, turns are ranked by the
 * order they were first seen, and once a newer turn has put text on screen a
 * frame of any older turn — its late final included — is ignored. Until then an
 * older turn still shows, so a final that lands before the next sentence has
 * words is read as usual.
 *
 * Pure (no React Native imports), so it runs under `node --test`.
 */

/**
 * Turns remembered per speaker. A speaker overlaps at most a handful, so an
 * evicted id is long finished; one arriving again would rank as new.
 */
const REMEMBERED_TURNS = 32;

interface SpeakerTurns {
  /** turnId → first-seen rank. */
  rank: Map<string, number>;
  nextRank: number;
  /** Rank of the newest turn that has shown text; -1 before any. */
  newestShown: number;
}

export class SubtitleTurnOrder {
  private readonly speakers = new Map<string, SpeakerTurns>();

  /**
   * Take one frame and say whether it still concerns the line: false once a
   * newer turn of this speaker has shown text. `hasText` is whether the frame
   * carries anything on this listener's channel; only a frame with text claims
   * the line, but a current frame without it is still current — its final must
   * still schedule the clear of what its turn already showed.
   */
  accept(speaker: string, turnId: string, hasText: boolean): boolean {
    let turns = this.speakers.get(speaker);
    if (!turns) {
      turns = { rank: new Map(), nextRank: 0, newestShown: -1 };
      this.speakers.set(speaker, turns);
    }
    let rank = turns.rank.get(turnId);
    if (rank === undefined) {
      rank = turns.nextRank++;
      turns.rank.set(turnId, rank);
      if (turns.rank.size > REMEMBERED_TURNS) {
        const oldest = turns.rank.keys().next().value;
        if (oldest !== undefined) turns.rank.delete(oldest);
      }
    }
    if (rank < turns.newestShown) return false;
    if (hasText) turns.newestShown = rank;
    return true;
  }

  /** The speaker left: a later return starts with no history. */
  forget(speaker: string): void {
    this.speakers.delete(speaker);
  }
}
