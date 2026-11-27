import type { MessageKey } from '@chatofy/i18n';

/**
 * Tells the overlay about a relay failure, in the reader's language.
 *
 * Failures arrive at the rate audio is produced, and a banner rewritten five times
 * a second is a flicker, so a failure whose sentence is already the banner is
 * dropped. The comparison is against what the overlay shows NOW rather than a
 * remembered last report: a stop, a capture error or a new capture clears the
 * banner without telling this class, and the same failure must then show again.
 *
 * The caller passes a dictionary key, never English: the English `detail` goes to
 * the console for a developer and nowhere near the reader.
 */
export class RelayFailureReporter {
  constructor(
    private readonly publish: (message: string) => void,
    private readonly showing: () => string | undefined,
    private readonly translate: (key: MessageKey) => string,
    private readonly log: (detail: string) => void = (detail) =>
      console.warn('[chatofy] outbound relay failed:', detail),
  ) {}

  report(key: MessageKey, detail: string): void {
    const message = this.translate(key);
    if (this.showing() === message) return;
    this.log(detail);
    this.publish(message);
  }
}
