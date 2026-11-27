import type { MessageKey } from '@chatofy/i18n';

export interface RelayFailureReporterDeps {
  /** Put a message in the worker's `relay` slot. */
  publish: (message: string) => void;
  /** Empty the `relay` slot. */
  clear: () => void;
  /** What the `relay` slot shows right now, if anything. */
  showing: () => string | undefined;
  translate: (key: MessageKey) => string;
  log?: (detail: string) => void;
}

/**
 * Owns the overlay's `relay` slot: tells the reader about a failure on the way
 * from their microphone to the meeting page, in their language, and takes it down
 * again when that path recovers.
 *
 * Failures arrive at the rate audio is produced, and a banner rewritten five times
 * a second is a flicker, so a failure whose sentence is already the banner is
 * dropped. The comparison is against what the overlay shows NOW rather than a
 * remembered last report: a stop, a capture error or a new capture clears the
 * banner without telling this class, and the same failure must then show again.
 *
 * Two different failures share the slot — the relay of audio commands into the
 * page, and preparing the page for the patched microphone — and each recovers on
 * its own path. A recovery clears the banner only when one of ITS keys put the
 * sentence there, so a relay frame going through cannot erase "the page could not
 * be prepared", which is still true. The key is remembered alongside the banner
 * for exactly that; it may outlive the banner (after a stop) and is then ignored,
 * because a clear first checks that something is showing at all — which also keeps
 * a healthy relay from publishing anything per frame.
 *
 * The caller passes a dictionary key, never English: the English `detail` goes to
 * the console for a developer and nowhere near the reader.
 */
export class RelayFailureReporter {
  private shownKey: MessageKey | undefined;
  private readonly log: (detail: string) => void;

  constructor(private readonly deps: RelayFailureReporterDeps) {
    this.log = deps.log ?? ((detail) => console.warn('[chatofy] outbound relay failed:', detail));
  }

  /**
   * Show a failure, logging `detail` only when the banner actually changes.
   *
   * `detail` is optional for a caller that already logged its own error object,
   * which carries more than a sentence would.
   */
  report(key: MessageKey, detail?: string): void {
    const message = this.deps.translate(key);
    if (this.deps.showing() === message) return;
    if (detail !== undefined) this.log(detail);
    this.shownKey = key;
    this.deps.publish(message);
  }

  /** The path behind `keys` works again: clear the banner if one of them set it. */
  recover(keys: readonly MessageKey[]): void {
    if (this.deps.showing() === undefined) return;
    if (this.shownKey === undefined || !keys.includes(this.shownKey)) return;
    this.shownKey = undefined;
    this.deps.clear();
  }
}
