import type { TranslationDirection, VoiceGender } from '@chatofy/types';
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
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* The outbound state, which is not an error and must not be dressed as one:
     monitor is the honest name for a translation only the user can hear. */
  .outbound {
    padding: 7px 12px;
    background: rgba(30, 58, 138, 0.9);
    color: #dbeafe;
    font-size: 12px;
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
  /* The user's own turns, indented and marked. With both directions running the
     transcript interleaves two conversations that are translations of each
     other, and without a side the reader cannot tell which is which. */
  .line.mine { padding-left: 14px; border-left: 2px solid rgba(96, 165, 250, 0.8); }
  .who { color: #60a5fa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .source { color: #a1a1aa; font-size: 12px; }
  .target { color: #f4f4f5; }
  .empty { padding: 10px 12px 14px; color: #a1a1aa; }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .toggle {
    font: inherit;
    font-weight: 600;
    color: #f4f4f5;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 5px 14px;
    cursor: pointer;
    flex: none;
  }
  .toggle:hover { background: rgba(255, 255, 255, 0.18); }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #f4f4f5;
    flex: 1 0 100%;
    cursor: pointer;
  }
  .check input { margin: 0; }
  /* Visible focus matters more than usual: this button sits on someone else's page,
     where no surrounding style system guarantees one. */
  .toggle:focus-visible { outline: 2px solid #f4f4f5; outline-offset: 2px; }
  .setting {
    font: inherit;
    font-size: 12px;
    color: #f4f4f5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 4px 6px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .setting:focus-visible { outline: 2px solid #f4f4f5; outline-offset: 2px; }
  .hint { color: #a1a1aa; font-size: 12px; flex: 1 0 100%; }
`;

/**
 * What the outbound direction is doing, in words that name the next step.
 *
 * The unpatched case is the one worth spelling out. A page that was already open
 * when the patch was switched on cannot be given it retroactively, and the fix is
 * two steps rather than one: reloading throws away the `activeTab` grant that
 * `tabCapture` needs, so the Start button below will not work afterwards and the
 * user has to invoke the extension through Chrome's own UI again. Saying only
 * "reload" would walk them into that.
 */
function outboundMessage(state: OverlayState): string {
  if (state.outbound === 'sending') return 'Your speech is being translated into the meeting.';
  if (state.patched === false) {
    return state.shortcut
      ? `Your speech is translated for you only. To send it to the meeting, reload this page, then press ${state.shortcut} to start again.`
      : 'Your speech is translated for you only. To send it to the meeting, reload this page, then right-click → Chatofy to start again.';
  }
  return 'Your speech is translated for you only — the others hear your own voice.';
}

/** A labelled select, built without `innerHTML` like everything else in here. */
function select(
  name: string,
  options: ReadonlyArray<readonly [string, string]>,
): HTMLSelectElement {
  const node = document.createElement('select');
  node.className = 'setting';
  node.title = name;
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    node.append(option);
  }
  return node;
}

class Overlay {
  private readonly root: ShadowRoot;
  private readonly indicator: HTMLDivElement;
  private readonly errorBox: HTMLDivElement;
  private readonly outboundBox: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly panel: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly hint: HTMLSpanElement;
  private readonly direction: HTMLSelectElement;
  private readonly voice: HTMLSelectElement;
  private readonly outbound: HTMLInputElement;

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

    this.outboundBox = document.createElement('div');
    this.outboundBox.className = 'outbound';
    this.outboundBox.hidden = true;

    this.list = document.createElement('ul');
    this.list.className = 'lines';

    // The control row, and the reason it is a row of its own rather than a button
    // on the indicator: this starts and stops CAPTURE. The indicator is not
    // dismissible and must not look like it is.
    const controls = document.createElement('div');
    controls.className = 'controls';
    this.toggle = document.createElement('button');
    this.toggle.className = 'toggle';
    this.toggle.type = 'button';
    this.hint = document.createElement('span');
    this.hint.className = 'hint';

    // Direction and voice live here as well as in the popup, and that is not
    // duplication for its own sake: a call in its own window has no toolbar, so the
    // popup can only be opened from some other tab in some other window. Without
    // these, the only thing reachable mid-call would be start and stop.
    this.direction = select('direction', [
      ['en_to_vi', 'EN → VI'],
      ['vi_to_en', 'VI → EN'],
    ]);
    this.voice = select('voice', [
      ['female', 'Female voice'],
      ['male', 'Male voice'],
    ]);

    // Translating the user's own speech is a separate choice from translating
    // the meeting, because it opens their microphone and speaks for them.
    const outboundLabel = document.createElement('label');
    outboundLabel.className = 'check';
    this.outbound = document.createElement('input');
    this.outbound.type = 'checkbox';
    const outboundText = document.createElement('span');
    outboundText.textContent = 'Also translate what I say';
    outboundLabel.append(this.outbound, outboundText);

    controls.append(this.toggle, this.direction, this.voice, outboundLabel, this.hint);

    for (const input of [this.direction, this.voice, this.outbound]) {
      // Sent to the worker rather than written here. It owns the store and is the
      // only context that can reopen a running capture so the change takes effect
      // mid-call; it also keeps the shared types package out of this bundle, which
      // is injected into every meeting page.
      input.addEventListener('change', () => {
        void chrome.runtime
          .sendMessage({
            to: 'worker',
            type: 'settings',
            direction: this.direction.value as TranslationDirection,
            voiceGender: this.voice.value as VoiceGender,
            outbound: this.outbound.checked,
          })
          .catch(() => undefined);
      });
    }

    this.toggle.addEventListener('click', () => {
      // Nothing is updated locally. A click in the page cannot itself grant the
      // permission capture needs, so the honest answer — started, or the reason it
      // could not be — comes back from the worker as a render.
      void chrome.runtime.sendMessage({ to: 'worker', type: 'toggle' }).catch(() => undefined);
    });

    this.panel.append(this.indicator, this.errorBox, this.outboundBox, this.list, controls);
    this.root.append(style, this.panel);
    document.body.append(host);
  }

  render(state: OverlayState): void {
    // Whatever the worker says is stored, wherever it was last changed from — this
    // overlay or the popup.
    if (state.settings) {
      this.direction.value = state.settings.direction;
      this.voice.value = state.settings.voiceGender;
      this.outbound.checked = state.settings.outbound;
    }
    // The panel stays. It used to hide itself when idle, which was fine while the
    // popup was the only way to start — in a call window with no toolbar, hiding it
    // would take away the only control there is. The indicator still appears for
    // exactly as long as capture runs, and there is deliberately no branch that
    // hides it while `capturing` is true.
    this.indicator.hidden = !state.capturing;

    // One line per failing direction. A single line cannot say that the meeting
    // is being translated fine while nothing the user says reaches anyone.
    const failures: string[] = [];
    if (state.errors.capture) failures.push(state.errors.capture);
    if (state.errors.inbound) failures.push(`Meeting audio: ${state.errors.inbound}`);
    if (state.errors.outbound) failures.push(`Your microphone: ${state.errors.outbound}`);
    this.errorBox.hidden = failures.length === 0;
    this.errorBox.replaceChildren();
    for (const failure of failures) {
      const line = document.createElement('span');
      line.textContent = failure;
      this.errorBox.append(line);
    }

    // Says what the other participants can actually hear.
    this.outboundBox.hidden = !state.capturing || state.outbound === 'off';
    this.outboundBox.textContent = outboundMessage(state);

    this.toggle.textContent = state.capturing ? 'Stop' : 'Start';
    this.hint.hidden = state.capturing;
    // The first start in a window like this one cannot come from the button: Chrome
    // only grants capture to an extension the user invoked through Chrome's own UI.
    // So the hint names the ways that work, using the shortcut actually assigned —
    // there may be none, and printing the suggested one anyway would be a lie.
    this.hint.textContent = state.shortcut
      ? `First time here: press ${state.shortcut}, or right-click → Chatofy`
      : 'First time here: right-click → Chatofy';

    this.list.replaceChildren();
    if (state.lines.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = state.capturing ? 'Listening…' : 'Not capturing.';
      this.list.append(empty);
      return;
    }

    for (const line of state.lines) {
      const item = document.createElement('li');
      item.className = line.final ? 'line' : 'line live';
      if (line.origin === 'me') {
        item.classList.add('mine');
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = 'You';
        item.append(who);
      }

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
  // Must stay in step with `host_permissions` and `supportOf` in
  // `src/supported-meeting-url.ts`. WXT reads this statically, so it cannot be
  // imported from there.
  matches: [
    'https://meet.google.com/*',
    'https://*.zoom.us/wc/*',
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
