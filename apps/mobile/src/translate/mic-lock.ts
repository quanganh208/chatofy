/**
 * One microphone owner at a time. A meeting holds the microphone for as long as
 * the call lasts and the translate screen opens its own recorder; two recorders on
 * one device is device-dependent and, where it works, the second hears the first's
 * playback. Whoever asks second is refused and told why, and the one running is
 * never stopped on their behalf.
 */

export type MicOwner = 'translate' | 'conference';

export class MicLock {
  private owner: MicOwner | null = null;
  private readonly listeners = new Set<() => void>();

  /** True when `who` now holds the microphone (or already did). */
  acquire(who: MicOwner): boolean {
    if (this.owner !== null && this.owner !== who) return false;
    if (this.owner === who) return true;
    this.owner = who;
    this.notify();
    return true;
  }

  /**
   * Releases only a lock `who` holds, so a late release cannot free someone else's.
   * True when it did: the caller had the microphone and has its own cleanup to do.
   */
  release(who: MicOwner): boolean {
    if (this.owner !== who) return false;
    this.owner = null;
    this.notify();
    return true;
  }

  heldBy(): MicOwner | null {
    return this.owner;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The app's one lock. */
export const micLock = new MicLock();
