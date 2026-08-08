import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import { color, fontSize, fontWeight, overlay, radius, space } from '@chatofy/ui';
import { forContext, type OverlayState } from '../../src/messages';
import { asOutboundReport } from '../../src/outbound-channel';

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
 * That last sentence used to be false in the other direction. `[hidden]` is a
 * UA-origin rule, and an author `display: flex` outranks it — so `.indicator` and
 * `.error`, which both set one, ignored the `hidden` property entirely: the
 * indicator claimed the meeting was being recorded whether it was or not, and the
 * error bar was a permanent empty strip. `.outbound` and `.hint` set no `display`
 * and hid correctly, which is what made it look deliberate. The rule at the end of
 * this sheet is the fix; measured in Chromium rather than reasoned about.
 *
 * The reset is `!important`, because styles cross into a shadow tree in one
 * direction: normal declarations from the outer tree beat `:host`, so a page could
 * hide the indicator with one rule. Measured, the important form also defeats an
 * inline `style="display:none!important"` the page sets on the host, which is the
 * part that is not obvious.
 *
 * It closes a second route as well, though not the one it is tempting to describe.
 * A bare `transform` on the host does nothing, because `all: initial` leaves the
 * host `display: inline` and transforms do not apply to a non-replaced inline box.
 * Paired with `display: block` it does: the host becomes a containing block for the
 * fixed panel inside it, and the page can then translate the overlay off screen —
 * `filter`, `perspective` and `will-change` do the same. `all` covers that whole
 * family; an enumerated list of `display`/`visibility`/`opacity` would not.
 *
 * The cost of the blanket form: a later normal `:host` declaration in this sheet
 * would lose to it, silently. There is exactly one `:host` rule, and it should stay
 * that way.
 *
 * What none of it closes, because nothing inside a shadow tree can reach an
 * ancestor: `body { display: none }`, `body { content-visibility: hidden }`, or a
 * `filter` on `html`. The last is the worst of them — the overlay is invisible while
 * still passing a hit test.
 *
 * The host also carries no id. That is not what protects it — the page can still
 * select it with `body > div`, and the harness does exactly that. It is dropped
 * because a fixed, extension-specific id is a way for a meeting site to detect that
 * a user is running this.
 *
 * Attached to `document.body` with no dependency on any of Meet's own selectors, so
 * a layout change upstream cannot break it.
 */

/**
 * Colours come from the shared token module, interpolated as LITERAL VALUES.
 *
 * Not as custom properties, and that is the load-bearing part. `all: initial`
 * does not reset custom properties — they cross a shadow boundary on purpose, as
 * a public styling interface — so an overlay themed with `var(--chatofy-*)` is
 * repaintable by the meeting page, including the recording indicator the page is
 * not allowed to touch. Nothing in this sheet may ever be a `var()`.
 *
 * Two values stay hardcoded here rather than joining the token module. The
 * `z-index` is overlay-specific and must not move because a web design decision
 * moved it. The font stack is set explicitly rather than inherited, because
 * inheriting the meeting page's font is one more thing the page controls.
 *
 * And no `prefers-color-scheme`, ever: inside a content script it reports the
 * OPERATING SYSTEM, not the page, so a light-mode laptop in a dark meeting would
 * get a white slab over the video.
 *
 * No backticks anywhere below — this is a template literal, and one ends it.
 */
const STYLE = `
  :host { all: initial !important; }
  .panel {
    position: fixed;
    right: ${space.md}px;
    bottom: ${space.md}px;
    z-index: 2147483647;
    width: 340px;
    max-height: 45vh;
    display: flex;
    flex-direction: column;
    font: ${fontSize.base}px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: ${color.text};
    background: ${overlay.bg};
    border: 1px solid ${overlay.border};
    border-radius: ${radius.md}px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .indicator {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 9px ${space.md - 4}px;
    background: ${color.liveFill};
    color: ${color.onAccent};
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.01em;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: ${color.onAccent};
    animation: pulse 1.6s ease-in-out infinite;
    flex: none;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
  .error {
    padding: ${space.sm}px ${space.md - 4}px;
    background: ${color.warningSubtle};
    color: ${color.text};
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
  }
  /* The outbound state, which is not an error and must not be dressed as one:
     monitor is the honest name for a translation only the user can hear. It takes
     the accent rather than the speaking colour because it reports a persistent
     MODE, not a translation currently being spoken. */
  .outbound {
    padding: 7px ${space.md - 4}px;
    background: ${color.accentSubtle};
    color: ${color.text};
    font-size: ${fontSize.sm}px;
  }
  .lines {
    margin: 0;
    padding: ${space.sm}px ${space.md - 4}px ${space.md - 4}px;
    list-style: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: ${space.md - 4}px;
  }
  /* A left rule per turn and room between them, the same rhythm the web
     transcript has. Identical stacked blocks with no rule are unscannable once a
     conversation runs past a few turns. */
  .line {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-left: 10px;
    border-left: 2px solid ${color.border};
  }
  .line.live { opacity: 0.75; font-style: italic; }
  /* The user's own turns, marked. With both directions running the transcript
     interleaves two conversations that are translations of each other, and
     without a side the reader cannot tell which is which. */
  .line.mine { border-left-color: ${color.accent}; }
  .who {
    color: ${color.accentText};
    font-size: ${fontSize.xs}px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* The translation is larger than what was heard, because it is the thing being
     read. Equal sizes made the eye pick a line every single turn. */
  .target { color: ${color.text}; font-size: ${fontSize.base + 1}px; font-weight: ${fontWeight.medium}; }
  .source { color: ${color.textMuted}; font-size: ${fontSize.sm}px; }
  .empty { padding: 10px ${space.md - 4}px 14px; color: ${color.textMuted}; }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${space.sm}px;
    padding: 9px ${space.md - 4}px;
    border-top: 1px solid ${overlay.border};
  }
  .toggle {
    font: inherit;
    font-weight: ${fontWeight.semibold};
    color: ${color.onAccent};
    background: ${color.accent};
    border: 1px solid transparent;
    border-radius: ${radius.sm}px;
    padding: 5px 14px;
    cursor: pointer;
    flex: none;
  }
  .toggle:hover { background: ${color.accentHover}; }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: ${fontSize.sm}px;
    color: ${color.text};
    flex: 1 0 100%;
    cursor: pointer;
  }
  .check input { margin: 0; accent-color: ${color.accent}; }
  /* Visible focus matters more than usual: these controls sit on someone else's
     page, where no surrounding style system guarantees one. */
  .toggle:focus-visible, .setting:focus-visible, .check:focus-within {
    outline: 2px solid ${color.accentText};
    outline-offset: 2px;
  }
  .setting {
    font: inherit;
    font-size: ${fontSize.sm}px;
    color: ${color.text};
    background: ${color.surfaceRaised};
    border: 1px solid ${color.borderControl};
    border-radius: ${radius.sm}px;
    padding: 4px 6px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .hint { color: ${color.textMuted}; font-size: ${fontSize.sm}px; flex: 1 0 100%; }
  /* The browser's own hidden-attribute rule is UA-origin, and every rule above is
     an author one, so the indicator and the error bar outranked it and ignored the
     property entirely. Belt and braces: last position would win the tie on its own,
     and important would win from anywhere. Everything in this tree is hidden by
     property, never by class. */
  [hidden] { display: none !important; }
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
  if (state.outbound === 'muted') {
    return 'You are muted in the meeting, so nothing you say is being captured or translated.';
  }
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
    // No id: not for protection, which is the `:host` reset's job, but so a meeting
    // site cannot detect a Chatofy user by looking for one. See the note at the top.
    const host = document.createElement('div');
    // Closed: the page must not be able to read a private meeting's transcript out
    // of our own DOM.
    this.root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;

    this.panel = document.createElement('div');
    this.panel.className = 'panel';

    this.indicator = document.createElement('div');
    this.indicator.className = 'indicator';
    // Hidden until a state says otherwise, like the two boxes below it. This script
    // runs on every meeting page, and `render` only arrives once the worker answers
    // — so a visible default announced that the meeting was being recorded on pages
    // where capture had never started.
    this.indicator.hidden = true;
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

    this.renderErrors(state);

    // Says what the other participants can actually hear.
    this.outboundBox.hidden = !state.capturing || state.outbound === 'off';
    this.outboundBox.textContent = outboundMessage(state);

    this.renderControls(state);
    this.renderLines(state);
  }

  /**
   * One line per failing direction.
   *
   * A single line cannot say that the meeting is being translated fine while
   * nothing the user says reaches anyone.
   */
  private renderErrors(state: OverlayState): void {
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
  }

  private renderControls(state: OverlayState): void {
    this.toggle.textContent = state.capturing ? 'Stop' : 'Start';
    this.hint.hidden = state.capturing;
    // The first start in a window like this one cannot come from the button: Chrome
    // only grants capture to an extension the user invoked through Chrome's own UI.
    // So the hint names the ways that work, using the shortcut actually assigned —
    // there may be none, and printing the suggested one anyway would be a lie.
    this.hint.textContent = state.shortcut
      ? `First time here: press ${state.shortcut}, or right-click → Chatofy`
      : 'First time here: right-click → Chatofy';
  }

  private renderLines(state: OverlayState): void {
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
      if (!forContentScript) return;
      if (forContentScript.type === 'render') {
        overlay.render(forContentScript.state);
        return;
      }
      // The last hop into the page's own world, where the patch is listening.
      // Nothing confidential travels here — see `src/outbound-channel.ts`.
      window.postMessage(forContentScript.command, window.origin);
    });

    // And the one fact coming back: whether the meeting client is still
    // transmitting the microphone it was handed.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const report = asOutboundReport(event.data);
      if (!report) return;
      void chrome.runtime
        .sendMessage({
          to: 'worker',
          type: 'outbound.transmitting',
          transmitting: report.transmitting,
        })
        .catch(() => undefined);
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
