import { forContext, type OverlayState } from '../../src/messages';

/**
 * The transcript overlay, and the indicator that says the meeting is being captured.
 *
 * Three decisions here are about safety rather than looks.
 *
 * `attachShadow({ mode: 'closed' })`. An open shadow root is readable through
 * `element.shadowRoot` by any script on the page, and what is inside is a live
 * transcript of a private meeting. Closed means the page cannot reach it at all.
 *
 * Text nodes, never `innerHTML`. Every line of the transcript is model output
 * derived from what someone said out loud. Assigning it as HTML would let a
 * sentence containing markup become markup, on a page belonging to someone else.
 *
 * The capture indicator cannot be dismissed. Everyone in the meeting is being
 * recorded and only the person running the extension knows; an indicator with a
 * close button is not an indicator. It is shown for exactly as long as capture is
 * running and there is no code path that hides it while it is.
 *
 * Attached to `document.body` with no dependency on any of Meet's own selectors, so
 * a layout change upstream cannot break it.
 */

const HOST_ID = 'chatofy-overlay-host';

const STYLE = `
  :host { all: initial; }
  .panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    width: 340px;
    max-height: 45vh;
    display: flex;
    flex-direction: column;
    font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #f4f4f5;
    background: rgba(24, 24, 27, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    background: rgba(185, 28, 28, 0.92);
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #fff;
    animation: pulse 1.6s ease-in-out infinite;
    flex: none;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
  .error {
    padding: 8px 12px;
    background: rgba(120, 53, 15, 0.95);
    color: #fef3c7;
  }
  .lines {
    margin: 0;
    padding: 8px 12px 12px;
    list-style: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .line { display: flex; flex-direction: column; gap: 2px; }
  .line.live { opacity: 0.72; font-style: italic; }
  .source { color: #a1a1aa; font-size: 12px; }
  .target { color: #f4f4f5; }
  .empty { padding: 10px 12px 14px; color: #a1a1aa; }
`;

class Overlay {
  private readonly root: ShadowRoot;
  private readonly indicator: HTMLDivElement;
  private readonly errorBox: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly panel: HTMLDivElement;

  constructor() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    // Closed: the page must not be able to read a private meeting's transcript out
    // of our own DOM.
    this.root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;

    this.panel = document.createElement('div');
    this.panel.className = 'panel';

    this.indicator = document.createElement('div');
    this.indicator.className = 'indicator';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = 'Chatofy is capturing this meeting’s audio';
    this.indicator.append(dot, label);

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'error';
    this.errorBox.hidden = true;

    this.list = document.createElement('ul');
    this.list.className = 'lines';

    this.panel.append(this.indicator, this.errorBox, this.list);
    this.root.append(style, this.panel);
    document.body.append(host);
  }

  render(state: OverlayState): void {
    // The panel exists only while capture does. There is deliberately no branch that
    // hides the indicator while `capturing` is true.
    this.panel.hidden = !state.capturing && state.lines.length === 0 && !state.error;
    this.indicator.hidden = !state.capturing;

    this.errorBox.hidden = !state.error;
    this.errorBox.textContent = state.error ?? '';

    this.list.replaceChildren();
    if (state.lines.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = state.capturing
        ? 'Listening…'
        : 'Not capturing. Open the Chatofy popup to start.';
      this.list.append(empty);
      return;
    }

    for (const line of state.lines) {
      const item = document.createElement('li');
      item.className = line.final ? 'line' : 'line live';

      const target = document.createElement('span');
      target.className = 'target';
      // textContent, never innerHTML: this string is model output derived from
      // speech, on a page that is not ours.
      target.textContent = line.targetText || '…';

      const source = document.createElement('span');
      source.className = 'source';
      source.textContent = line.sourceText;

      item.append(target, source);
      this.list.append(item);
    }
    // Newest line last, so the view follows the conversation.
    this.list.scrollTop = this.list.scrollHeight;
  }
}

export default defineContentScript({
  matches: [
    'https://meet.google.com/*',
    'https://*.zoom.us/wc/*',
    'https://www.messenger.com/*',
    'https://*.facebook.com/groupcall/*',
  ],
  runAt: 'document_idle',
  main() {
    const overlay = new Overlay();

    chrome.runtime.onMessage.addListener((message) => {
      const forContentScript = forContext(message, 'content');
      if (forContentScript?.type === 'render') overlay.render(forContentScript.state);
    });

    // Asked for on load rather than waited for: this script may be injected long
    // after capture began — a reload mid-meeting — and would otherwise show nothing
    // until the next turn.
    void chrome.runtime
      .sendMessage({ to: 'worker', type: 'query' })
      .then((state: OverlayState | undefined) => {
        if (state) overlay.render(state);
      })
      .catch(() => undefined);
  },
});
