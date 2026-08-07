import type { CaptureStatus, OverlayState, TranscriptLine } from './messages';

/** Newest lines last, bounded — the overlay is a window, not a transcript archive. */
export const MAX_OVERLAY_LINES = 40;

export interface OverlayPublisherDeps {
  /** Push a render to one tab. Must not reject; a tab with no listener is normal. */
  render: (tabId: number, state: OverlayState) => void;
  /**
   * Rebuild the context-menu title.
   *
   * Called on every publish, before the tab check, because a state change still
   * renames the menu item when there is no tab to render into.
   */
  refreshMenuTitle: () => void;
  /**
   * Whether the tab being rendered to carries the microphone patch.
   *
   * Asked at publish time rather than stored, so the answer cannot go stale
   * between a tab being patched and the next push. Undefined when nothing is
   * being captured, which the overlay reads as "not known yet" rather than "no".
   */
  patchedFor: (tabId: number | null) => boolean | undefined;
}

/**
 * The last state pushed to the overlay, and the decorations every push carries.
 *
 * Held rather than recomputed because a content script that loads late asks for
 * it — the `query` message answers from here. The decorations (`shortcut`,
 * `settings`, `patched`) are set by the worker as it learns them and re-applied
 * to every state, so a caller that only knows about transcript lines cannot
 * accidentally drop the shortcut hint someone in a toolbar-less call window
 * needs to stop.
 */
export class OverlayPublisher {
  private state: OverlayState = { capturing: false, lines: [], outbound: 'off', errors: {} };
  private shortcut: string | undefined;
  private settings: OverlayState['settings'];
  private target: number | null = null;

  constructor(private readonly deps: OverlayPublisherDeps) {}

  /** What a late-loading content script or the popup gets when it asks. */
  get current(): OverlayState {
    return this.state;
  }

  get capturing(): boolean {
    return this.state.capturing;
  }

  get lines(): TranscriptLine[] {
    return this.state.lines;
  }

  /**
   * The tab renders go to, or null when nothing is being captured.
   *
   * Set by the worker rather than tracked here: which tab is captured is a
   * capture decision, and this class only needs to know where to send.
   */
  setTarget(tabId: number | null): void {
    this.target = tabId;
  }

  setShortcut(shortcut: string | undefined): void {
    this.shortcut = shortcut;
  }

  setSettings(settings: OverlayState['settings']): void {
    this.settings = settings;
  }

  /** Re-send the state already held, after a decoration changed. */
  republish(): void {
    this.publish(this.state);
  }

  publish(state: OverlayState): void {
    this.state = {
      ...state,
      shortcut: this.shortcut,
      settings: this.settings,
      patched: this.deps.patchedFor(this.target),
    };
    // Before the early return: a state change renames the menu item even when
    // there is no tab to push a render to.
    this.deps.refreshMenuTitle();
    if (this.target === null) return;
    this.deps.render(this.target, this.state);
  }

  /** Reset to nothing captured, keeping the transcript on screen. */
  publishStopped(): void {
    this.publish({ capturing: false, lines: this.state.lines, outbound: 'off', errors: {} });
  }

  /** Report a capture failure, keeping the transcript on screen. */
  publishCaptureError(message: string): void {
    this.publish({
      capturing: false,
      lines: this.state.lines,
      outbound: 'off',
      errors: { capture: message },
    });
  }

  /** Merge an error into the errors already showing. */
  publishError(slot: 'capture' | 'outbound', message: string): void {
    this.publish({ ...this.state, errors: { ...this.state.errors, [slot]: message } });
  }

  /** Everything the previous meeting left behind, gone before this one renders. */
  reset(): void {
    this.state = { capturing: false, lines: [], outbound: 'off', errors: {} };
  }

  /** A blank slate for a tab that is being handed off. */
  static blank(): OverlayState {
    return { capturing: false, lines: [], outbound: 'off', errors: {} };
  }

  applyStatus(status: CaptureStatus): void {
    this.publish({
      capturing: status.capturing,
      lines: this.state.lines,
      outbound: status.outbound,
      // The offscreen document owns both direction errors and reports them
      // together, so they replace their own slots wholesale; `capture` is the
      // worker's and survives untouched.
      errors: { capture: this.state.errors.capture, ...status.errors },
    });
  }

  applyTranscript(lines: TranscriptLine[]): void {
    this.publish({
      capturing: this.state.capturing,
      outbound: this.state.outbound,
      errors: this.state.errors,
      lines: lines.slice(-MAX_OVERLAY_LINES),
    });
  }
}
