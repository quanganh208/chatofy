/**
 * The offscreen document that owns the audio graph.
 *
 * A service worker cannot hold an `AudioContext` and is killed when idle, so
 * every piece of audio — the captured tab stream, the echo microphone, the
 * translated speech — lives in a document this worker creates. Chrome permits
 * exactly one per extension, which is what makes "does it already exist" the
 * only question this class has to answer well.
 */

/** Chrome permits exactly one offscreen document per extension. */
export const OFFSCREEN_PATH = 'offscreen.html';

export interface OffscreenHostDeps {
  /**
   * Whether an offscreen document is already open.
   *
   * `getContexts` rather than "create and catch": creating one that exists
   * throws, and that error is indistinguishable from a real failure to create.
   */
  hasDocument: () => Promise<boolean>;
  createDocument: (path: string) => Promise<void>;
  closeDocument: () => Promise<void>;
  /** Send to the offscreen document. Resolves whether or not anyone listened. */
  send: (message: unknown) => Promise<void>;
}

export class OffscreenHost {
  constructor(private readonly deps: OffscreenHostDeps) {}

  exists(): Promise<boolean> {
    return this.deps.hasDocument();
  }

  /** Open the document if it is not already there. Safe to call repeatedly. */
  async ensure(): Promise<void> {
    if (await this.deps.hasDocument()) return;
    await this.deps.createDocument(OFFSCREEN_PATH);
  }

  /**
   * Tell the document to stop, then close it.
   *
   * Closed rather than left idle: while it exists it holds the microphone
   * permission indicator, and a document that is not capturing anything showing
   * a recording indicator is worse than no indicator at all.
   *
   * A no-op when no document is open, so a stop that races another stop does
   * not fail the second caller.
   */
  async endCapture(): Promise<void> {
    if (!(await this.deps.hasDocument())) return;
    await this.deps.send({ to: 'offscreen', type: 'end' });
    await this.deps.closeDocument();
  }
}
