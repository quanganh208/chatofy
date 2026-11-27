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
  /**
   * Whether a capture is running. The slot shows nothing while one is not: a
   * stopped overlay has no microphone path to report on.
   */
  capturing: () => boolean;
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
 *   A fact about the outbound SETTING, not about one capture, so it outlives a
 *   stop and is cleared only when preparing succeeds. Takes precedence: while it
 *   holds, no relayed frame can help, and a relay success must not erase it.
 * - `relayFailure` — a relayed command did not reach the meeting tab. A fact about
 *   one capture: cleared when a later command gets through, when outbound is
 *   turned off (nothing is relayed then, so nothing else would ever clear it), and
 *   when the capture ends ({@link resetRelay}).
 *
 * The text is derived only while a capture is running; otherwise the slot is
 * empty. So a stop hides a prepare failure that is still true, and the next
 * capture's first status brings it back through {@link refresh}.
 *
 * Every change recomputes the text and publishes only when it differs from what
 * the overlay shows NOW. Failures arrive at the rate audio is produced, so that
 * comparison is what keeps the banner from flickering and a healthy relay from
 * publishing per frame. Comparing against the overlay rather than a remembered
 * last publish matters too: a stop, a capture error or a new capture empties the
 * slot without telling this class.
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
  /** The last send issued before outbound was turned off or the relay was reset; its failures are stale. */
  private offSeq = 0;
  private settingsRun = 0;
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
   * `detail` is logged only when the failure is news. Dropped when the send
   * started before outbound was last turned off or the relay was last reset: it
   * was in flight then, and would otherwise bring back a banner nothing could clear.
   */
  relayFailed(key: RelayFailureKey, detail: string, seq: number = this.nextSend()): void {
    // Two fences against a failure that belongs to a capture already over. A
    // send numbered at or before the last reset or outbound-off is from before
    // it; and a failure while nothing is capturing — between a new capture's
    // reset and its first status, where the old capture's commands can still
    // land — has no capture to belong to. The second also covers a failure with
    // no send behind it, whose fresh seq cannot be told apart by number.
    if (seq <= this.offSeq || !this.deps.capturing()) return;
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

  /**
   * A number for one run of applying the outbound setting to the pages.
   *
   * Runs overlap — every storage write starts one — and settle out of order, so
   * only the newest run's outcome is applied; an older one describes a setting
   * that is no longer current.
   */
  beginSettingsRun(): number {
    this.settingsRun += 1;
    return this.settingsRun;
  }

  /**
   * A settings run finished: the pages were prepared for `outbound`, or not.
   *
   * With outbound off nothing is relayed any more, so no relay failure is true —
   * including one from a send still in flight, which {@link relayFailed} then
   * drops. The caller logs its own error object when preparing failed.
   */
  settingsSettled(run: number, outbound: boolean, prepared: boolean): void {
    if (run !== this.settingsRun) return;
    if (!outbound) {
      this.offSeq = this.sendSeq;
      this.relayFailure = undefined;
    }
    // Only a sync for outbound ON can fail to prepare a page. When removing the
    // patch fails after outbound was turned off, there is no microphone path in
    // use for the banner to describe.
    this.prepareFailed = outbound && !prepared;
    this.sync();
  }

  /**
   * The capture ended, or a new one is starting, and the slot was emptied with
   * it. Forgets the relay failure only: the prepare failure belongs to the
   * setting and stays. Sends made before this are fenced off, so one from the
   * old capture failing late cannot set the failure again. Publishes nothing.
   */
  resetRelay(): void {
    this.offSeq = this.sendSeq;
    this.relayFailure = undefined;
  }

  /** Re-derive the slot after the capture state changed. Publishes only a difference. */
  refresh(): void {
    this.sync();
  }

  private sync(): void {
    const key: MessageKey | undefined = !this.deps.capturing()
      ? undefined
      : this.prepareFailed
        ? 'extension.error.preparePageFailed'
        : this.relayFailure;
    const message = key === undefined ? undefined : this.deps.translate(key);
    if (this.deps.showing() === message) return;
    if (message === undefined) this.deps.clear();
    else this.deps.publish(message);
  }
}
