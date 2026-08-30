import type { CaptureStatus, MinutesOverlayState, OverlayState, TranscriptLine } from './messages';

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
  /**
   * The minutes request, held as a decoration and re-applied to every render.
   *
   * Kept apart from `state` for the same reason `shortcut` and `settings` are: a
   * transcript push or a status change rebuilds `state` from scratch, and folding
   * minutes in there would drop them on the next line the meeting produces.
   */
  private minutes: MinutesOverlayState | undefined;
  private target: number | null = null;
  /** See `markCaptureUnknown`. False in the normal case: this worker started the capture. */
  private captureUnknown = false;
  private known: Promise<void> = Promise.resolve();
  private resolveKnown: () => void = () => undefined;

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

  /** Store the minutes request and re-render it onto the overlay. */
  setMinutes(minutes: MinutesOverlayState | undefined): void {
    this.minutes = minutes;
    this.republish();
  }

  /** Re-send the state already held, after a decoration changed. */
  republish(): void {
    this.publish(this.state);
  }

  /**
   * Say that whether a capture is running is not known yet.
   *
   * Set when the worker restarts and finds an offscreen document already there:
   * that document holds the audio graph and outlives this worker, so a capture
   * may well be running, and nothing in `storage.session` records it. The worker
   * asks the document, and until the answer arrives this publisher must not
   * assert the thing it does not know.
   *
   * Without this the repair is best-effort in the wrong direction. Several paths
   * publish during that window — a settings write, a tab update, a failure inside
   * the worker's own start-up — and every one of them would render
   * `capturing: false` into a meeting that is still being recorded. Suppressing
   * them makes the unknown state fail safe: the indicator stays as it is until
   * something authoritative says otherwise.
   */
  markCaptureUnknown(): void {
    if (this.captureUnknown) return;
    this.captureUnknown = true;
    this.known = new Promise((resolve) => {
      this.resolveKnown = resolve;
    });
  }

  /**
   * Resolves once the answer is in — or immediately, when it never left.
   *
   * The suppression in `publish` protects renders the worker pushes. It does not
   * protect the one a content script PULLS: a `query` is answered from the held
   * state directly, so a page loading inside the unknown window would be handed
   * `capturing: false` and hide the indicator on a meeting still being recorded.
   * The caller waits on this instead of answering from a guess.
   */
  whenCaptureKnown(): Promise<void> {
    return this.known;
  }

  /**
   * The question has been answered without a status arriving.
   *
   * There being no offscreen document at all is itself the answer: nothing holds
   * an audio graph, so nothing is capturing. Separate from {@link applyStatus}
   * because no status will ever come in that case.
   */
  clearCaptureUnknown(): void {
    this.captureUnknown = false;
    this.resolveKnown();
  }

  publish(state: OverlayState): void {
    this.state = {
      ...state,
      shortcut: this.shortcut,
      settings: this.settings,
      patched: this.deps.patchedFor(this.target),
      minutes: this.minutes,
    };
    // Before the early return: a state change renames the menu item even when
    // there is no tab to push a render to.
    this.deps.refreshMenuTitle();
    if (this.target === null) return;
    // A claim we are not entitled to make yet — see `markCaptureUnknown`. The
    // state is still stored, so the moment the truth arrives the next push is
    // built on top of it.
    if (this.captureUnknown && !this.state.capturing) return;
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
    // The last meeting's minutes are part of "everything left behind" — cleared
    // here so a new capture does not open showing a summary of the old one.
    this.minutes = undefined;
  }

  /** A blank slate for a tab that is being handed off. */
  static blank(): OverlayState {
    return { capturing: false, lines: [], outbound: 'off', errors: {} };
  }

  applyStatus(status: CaptureStatus): void {
    // The offscreen document is the only thing that knows, and this is it
    // answering. Whatever it says, the guess is over.
    this.clearCaptureUnknown();
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
