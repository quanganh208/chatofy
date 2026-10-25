/**
 * Runs async tasks strictly one after another.
 *
 * Signaling replies are matched by event name, and the SFU rejects a second
 * negotiation on a connection whose last one is unanswered, so every exchange
 * on a peer connection goes through one of these. A failed task is handed to
 * its own error handler and never stops the tasks queued behind it.
 */
export class SerialChain {
  private tail: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<void>, onError: (err: unknown) => void): void {
    this.tail = this.tail.then(task).catch(onError);
  }

  /** Resolves once every task queued so far has settled. Never rejects. */
  drained(): Promise<void> {
    return this.tail;
  }
}
