import type { MessageKey } from '@chatofy/i18n';

/**
 * Tells the overlay once per kind of relay failure, in the reader's language.
 *
 * Failures arrive at the rate audio is produced, and a banner rewritten five times
 * a second is a flicker, so a repeat of the failure already showing is dropped.
 * The caller passes a dictionary key, never English: the English `detail` goes to
 * the console for a developer and nowhere near the reader.
 */
export class RelayFailureReporter {
  private reported: MessageKey | undefined;

  constructor(
    private readonly publish: (message: string) => void,
    private readonly translate: (key: MessageKey) => string,
    private readonly log: (detail: string) => void = (detail) =>
      console.warn('[chatofy] outbound relay failed:', detail),
  ) {}

  report(key: MessageKey, detail: string): void {
    if (this.reported === key) return;
    this.reported = key;
    this.log(detail);
    this.publish(this.translate(key));
  }

  /** Forget the last failure, so the next one is shown again. */
  reset(): void {
    this.reported = undefined;
  }
}
