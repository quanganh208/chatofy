import type { TranslationDirection, VoiceGender } from '@chatofy/types';
import type { OverlayState } from '../../src/messages';
import { visibleOverlayPart } from '../../src/site-enablement';
import { brandMark } from '@chatofy/ui';
import { OVERLAY_STYLE } from './overlay-styles';

/**
 * The transcript overlay, and the indicator that says the meeting is being
 * captured.
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
 * **The capture indicator cannot be dismissed.** Everyone in the meeting is being
 * recorded and only the person running the extension knows; an indicator with a
 * close button is not an indicator. There are three ways to make less of this
 * overlay — collapsing it, switching Chatofy off globally, switching it off for
 * a platform — and none is a route to that. Collapsing while capture runs gives
 * the red pill, which pulses. Switching a platform off does not hide a running
 * capture either: the worker stops it, and `index.ts` keeps this mounted until
 * the render saying so arrives.
 *
 * Both halves of that rule live in `src/site-enablement.ts` as pure functions —
 * `visibleOverlayPart` and `mayUnmountOverlay` — which is where their tests are.
 *
 * The host carries no id. That is not what protects it — the page can still
 * select it with `body > div`, and the harness does exactly that. It is dropped
 * because a fixed, extension-specific id is a way for a meeting site to detect
 * that a user is running this.
 *
 * Attached to `document.body` with no dependency on any of Meet's own selectors,
 * so a layout change upstream cannot break it.
 */

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

/**
 * A labelled select, built without `innerHTML` like everything else in here.
 *
 * The label is an accessible name, not a tooltip. These used to carry `title` set
 * to the internal field name — "direction", "voice" — which reached a screen
 * reader, and a sighted user hovering, as vocabulary from the message schema
 * rather than from the product.
 */
function select(
  label: string,
  options: ReadonlyArray<readonly [string, string]>,
): HTMLSelectElement {
  const node = document.createElement('select');
  node.className = 'setting';
  node.setAttribute('aria-label', label);
  // `text`, not `label`: naming it `label` shadows the accessible name this
  // function was given, and the two are only interchangeable while nothing below
  // reads the outer one.
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    node.append(option);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The full-dawn lotus, built node by node from `brandMark`.
 *
 * `createElementNS`, because this file never parses a string into markup — the
 * same rule that keeps transcript text out of `innerHTML` keeps the mark out of
 * it. Full-dawn because the overlay is permanently dark: ink side petals would
 * vanish into it. The ids only have to be unique inside this shadow root, which
 * holds exactly one mark.
 *
 * The gap is widened for small sizes rather than taken as a constant. `gapWidth`
 * is in the mark's 64-unit space, so at the pill's 16px it lands on 3/64 × 16 =
 * 0.75 device px at 1x — under one pixel, which rounds away and fuses the three
 * petals into one shape. `viewBox / size` is whatever buys a full pixel back, and
 * `max` keeps it a no-op at every size big enough not to need it.
 */
function lotusMark(size: number): SVGSVGElement {
  const m = brandMark;
  const [bx, by] = m.base;
  const gap = Math.max(m.gapWidth, m.viewBox / size);
  const node = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
    children: Element[] = [],
  ): SVGElementTagNameMap[K] => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    element.append(...children);
    return element;
  };
  const gradient = (
    id: string,
    [x1, y1, x2, y2]: [number, number, number, number],
    stops: [number, string][],
  ) =>
    node(
      'linearGradient',
      { id, x1, y1, x2, y2 },
      stops.map(([offset, color]) => node('stop', { offset, 'stop-color': color })),
    );
  const side = (angle: number, fill: string) =>
    node('path', { d: m.sidePath, transform: `rotate(${angle} ${bx} ${by})`, fill });

  return node(
    'svg',
    { width: size, height: size, viewBox: `0 0 ${m.viewBox} ${m.viewBox}`, 'aria-hidden': 'true' },
    [
      node('defs', {}, [
        gradient(
          'lotus-d',
          [0, 0, 0, 1],
          [
            [0, m.stops.tip],
            [0.5, m.stops.body],
            [1, m.stops.root],
          ],
        ),
        gradient(
          'lotus-l',
          [0, 0, 1, 1],
          [
            [0, m.sideStops.left.from],
            [1, m.sideStops.left.to],
          ],
        ),
        gradient(
          'lotus-r',
          [1, 0, 0, 1],
          [
            [0, m.sideStops.right.from],
            [1, m.sideStops.right.to],
          ],
        ),
        node(
          'mask',
          {
            id: 'lotus-g',
            maskUnits: 'userSpaceOnUse',
            x: 0,
            y: 0,
            width: m.viewBox,
            height: m.viewBox,
          },
          [
            node('rect', { width: m.viewBox, height: m.viewBox, fill: '#fff' }),
            node('path', {
              d: m.midPath,
              fill: 'none',
              stroke: '#000',
              'stroke-width': gap,
            }),
          ],
        ),
      ]),
      node('g', { mask: 'url(#lotus-g)' }, [
        side(-m.sideAngle, 'url(#lotus-l)'),
        side(m.sideAngle, 'url(#lotus-r)'),
        node('path', { d: m.midPath, fill: 'url(#lotus-d)' }),
      ]),
    ],
  );
}

export class Overlay {
  private readonly root: ShadowRoot;
  private readonly container: HTMLDivElement;
  private readonly pill: HTMLButtonElement;
  private readonly pillMark: HTMLSpanElement;
  private readonly pillDot: HTMLSpanElement;
  private readonly pillLabel: HTMLSpanElement;
  private readonly chevron: HTMLSpanElement;
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

  /**
   * Collapsed until asked otherwise.
   *
   * Per page load rather than stored. A meeting is the unit someone decides this
   * for, and persisting it would carry one call's choice into the next one — the
   * panel reappearing over a call it was never opened on is the behaviour this
   * redesign exists to remove.
   */
  private expanded = false;
  private state: OverlayState = { capturing: false, lines: [], outbound: 'off', errors: {} };
  private readonly host: HTMLDivElement;

  constructor() {
    // No id: not for protection, which is the `:host` reset's job, but so a
    // meeting site cannot detect a Chatofy user by looking for one.
    const host = document.createElement('div');
    this.host = host;
    // Closed: the page must not be able to read a private meeting's transcript out
    // of our own DOM.
    this.root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLE;

    this.container = document.createElement('div');
    this.container.className = 'root';

    // The collapsed surface. A button rather than a styled div so it is reachable
    // by keyboard on a page whose own tab order we do not control.
    this.pill = document.createElement('button');
    this.pill.className = 'pill';
    this.pill.type = 'button';
    // Idle, the pill leads with the lotus. Live, the mark gives way to the pulsing
    // dot — the recording indicator is never traded for a logo.
    this.pillMark = document.createElement('span');
    this.pillMark.className = 'pill-mark';
    this.pillMark.append(lotusMark(16));
    this.pillDot = document.createElement('span');
    this.pillDot.className = 'pill-dot';
    this.pillLabel = document.createElement('span');
    this.chevron = document.createElement('span');
    this.chevron.className = 'chevron';
    this.chevron.textContent = '▲';
    this.pill.append(this.pillMark, this.pillDot, this.pillLabel, this.chevron);
    this.pill.addEventListener('click', () => this.setExpanded(true));

    this.panel = document.createElement('div');
    this.panel.className = 'panel';

    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'Chatofy';
    const collapse = document.createElement('button');
    collapse.className = 'collapse';
    collapse.type = 'button';
    collapse.textContent = '▾';
    collapse.title = 'Collapse';
    collapse.setAttribute('aria-label', 'Collapse Chatofy');
    collapse.addEventListener('click', () => this.setExpanded(false));
    header.append(title, collapse);

    this.indicator = document.createElement('div');
    this.indicator.className = 'indicator';
    // Hidden until a state says otherwise, like the two boxes below it. This
    // script runs on every meeting page, and `render` only arrives once the worker
    // answers — so a visible default announced that the meeting was being recorded
    // on pages where capture had never started.
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
    // Written out rather than arrowed, and left as a select rather than rebuilt as
    // the two-sided control web uses. This panel is 340px wide over someone else's
    // call and has already had to fight for the vertical space its Stop row needs;
    // a second stacked row would take that back. A select states both languages in
    // one line and stays reachable from a keyboard.
    this.direction = select('Translate', [
      ['en_to_vi', 'English into Vietnamese'],
      ['vi_to_en', 'Vietnamese into English'],
    ]);
    this.voice = select('Voice', [
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

    // The two settings share a row of their own, under the button rather than
    // beside it.
    const settingsRow = document.createElement('div');
    settingsRow.className = 'settings-row';
    settingsRow.append(this.direction, this.voice);

    controls.append(this.toggle, settingsRow, outboundLabel, this.hint);

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

    this.panel.append(header, this.indicator, this.errorBox, this.outboundBox, this.list, controls);
    this.container.append(this.pill, this.panel);
    this.root.append(style, this.container);
    document.body.append(host);

    this.applyVisibility();
  }

  /**
   * Take the whole overlay off the page.
   *
   * Called only when Chatofy is switched off for this platform, and only once
   * nothing is being captured — `mayUnmountOverlay` is the guard, and it lives
   * apart from this class so the rule can be tested without a DOM. Removing the
   * host is the difference between "off" meaning the panel is hidden and "off"
   * meaning the extension left no trace on the page.
   */
  destroy(): void {
    this.host.remove();
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const capturing = this.state.capturing;
    const part = visibleOverlayPart({ capturing, expanded: this.expanded });
    this.pill.hidden = part !== 'pill';
    this.panel.hidden = part !== 'panel';

    // The collapsed surface says which of the two states it is standing in for.
    // A neutral "Chatofy" pill over a call that is being recorded would be the
    // dismissible indicator this overlay is not allowed to have.
    this.pill.classList.toggle('live', capturing);
    this.pillMark.hidden = capturing;
    this.pillDot.hidden = !capturing;
    this.pillLabel.textContent = capturing ? 'Recording' : 'Chatofy';
    this.pill.title = capturing
      ? 'Chatofy is capturing this meeting’s audio — open to stop'
      : 'Open Chatofy';
  }

  render(state: OverlayState): void {
    // Whatever the worker says is stored, wherever it was last changed from — this
    // overlay or the popup.
    if (state.settings) {
      this.direction.value = state.settings.direction;
      this.voice.value = state.settings.voiceGender;
      this.outbound.checked = state.settings.outbound;
    }

    // Capture starting is the one event that opens the panel by itself. The user
    // asked for this — through the popup, the shortcut or the context menu — and a
    // translation nobody can read is not the thing they asked for. Stopping does
    // not close it again: the transcript stays readable after the call.
    if (state.capturing && !this.state.capturing) this.expanded = true;
    this.state = state;

    this.indicator.hidden = !state.capturing;

    this.renderErrors(state);

    // Says what the other participants can actually hear.
    this.outboundBox.hidden = !state.capturing || state.outbound === 'off';
    this.outboundBox.textContent = outboundMessage(state);

    this.renderControls(state);
    this.renderLines(state);
    this.applyVisibility();
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
    this.toggle.classList.toggle('stop', state.capturing);
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
