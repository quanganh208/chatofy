import type { MessageKey } from '@chatofy/i18n';

/** The relay failures — the two ways a relayed command can fail to reach the page. */
export type RelayFailureKey = Extract<
  MessageKey,
  'extension.error.relayTabLost' | 'extension.error.relayTabUnreachable'
>;

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
 * Owns the overlay's `relay` slot: the path from the user's microphone into the
 * meeting page, said in the reader's language.
 *
 * Two independent things can be wrong on that path, and the slot shows one of
 * them, so this class keeps them as two facts and DERIVES the text rather than
 * letting either writer overwrite the other:
 *
 * - `prepareFailed` — the page could not be prepared for the patched microphone.
 *   Cleared only when preparing succeeds. Takes precedence: while it holds, no
 *   relayed frame can help, and a relay success must not erase it.
 * - `relayFailure` — a relayed command did not reach the meeting tab. Cleared when
 *   a later command gets through, or when preparing succeeds with outbound off —
 *   nothing is relayed then, so nothing would ever clear it otherwise.
 *
 * Every change recomputes the text and publishes only when it differs from what
 * the overlay shows NOW. Failures arrive at the rate audio is produced, so that
 * comparison is what keeps the banner from flickering and a healthy relay from
 * publishing per frame. Comparing against the overlay rather than a remembered
 * last publish matters too: a stop, a capture error or a new capture empties the
 * slot without telling this class — the worker calls {@link reset} beside each.
 *
 * Relayed sends settle out of order. Each one takes a sequence number from
 * {@link nextSend}, and a success clears the relay failure only when it was sent
 * after the newest failure; otherwise frame N's late success would erase frame
 * N+1's failure and the banner would republish once per frame while the path flaps.
 *
 * The caller passes dictionary keys, never English: the English `detail` goes to
 * the console for a developer and nowhere near the reader.
 */
export class RelayFailureReporter {
  private prepareFailed = false;
  private relayFailure: RelayFailureKey | undefined;
  private sendSeq = 0;
  private lastFailureSeq = 0;
  private readonly log: (detail: string) => void;

  constructor(private readonly deps: RelayFailureReporterDeps) {
    this.log = deps.log ?? ((detail) => console.warn('[chatofy] outbound relay failed:', detail));
  }

  /** A sequence number for one relayed send, in the order the sends were made. */
  nextSend(): number {
    this.sendSeq += 1;
    return this.sendSeq;
  }

  /**
   * A relayed command did not arrive.
   *
   * `seq` is the send's number; a failure with no send behind it (no tab to send
   * to) takes a fresh one, which orders it after every send already in flight.
   * `detail` is logged only when the failure is news.
   */
  relayFailed(key: RelayFailureKey, detail: string, seq: number = this.nextSend()): void {
    this.lastFailureSeq = Math.max(this.lastFailureSeq, seq);
    if (this.relayFailure !== key) this.log(detail);
    this.relayFailure = key;
    this.sync();
  }

  /** A relayed command arrived. Ignored when a newer send has already failed. */
  relayDelivered(seq: number): void {
    if (seq <= this.lastFailureSeq) return;
    this.relayFailure = undefined;
    this.sync();
  }

  /** The page could not be prepared. The caller logs its own error object. */
  preparePageFailed(): void {
    this.prepareFailed = true;
    this.sync();
  }

  /** Preparing succeeded; with outbound off, nothing is relayed any more either. */
  preparedPage(outbound: boolean): void {
    this.prepareFailed = false;
    if (!outbound) this.relayFailure = undefined;
    this.sync();
  }

  /** Forget both facts, beside a publish that empties the slot. Publishes nothing. */
  reset(): void {
    this.prepareFailed = false;
    this.relayFailure = undefined;
  }

  private sync(): void {
    const key: MessageKey | undefined = this.prepareFailed
      ? 'extension.error.preparePageFailed'
      : this.relayFailure;
    const message = key === undefined ? undefined : this.deps.translate(key);
    if (this.deps.showing() === message) return;
    if (message === undefined) this.deps.clear();
    else this.deps.publish(message);
  }
}
