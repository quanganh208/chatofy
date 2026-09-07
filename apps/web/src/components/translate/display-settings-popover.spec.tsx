// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranslateSettings } from '@/lib/translate-settings';

/**
 * The gear holds the page, and nothing about sound.
 *
 * It used to hold both, which is the arrangement this file first guarded against.
 * One icon at the end of the dock covered "what am I hearing" and "how is the
 * page arranged" while naming neither — and the speaker in the panel header, the
 * one element on the screen that is visibly about sound, configured nothing at
 * all. The voice lives with that header now.
 *
 * The second thing guarded here arrived with the other five controls: **a control
 * that has nothing to act on is ABSENT, not disabled.** `paneLayout` orients two
 * panes, so under `list` there is nothing for it to orient; under
 * `translationOnly` there is one side on screen, so neither the mode nor the
 * orientation has anything to say. Both failures are quiet — a segmented control
 * that renders and does nothing looks exactly like one that works — so the
 * absence is asserted from the states that produce it rather than from the
 * default.
 */

const { DisplaySettingsPopover } = await import('./display-settings-popover');
const { LocaleProvider } = await import('@/i18n/provider');
const { DEFAULT_TRANSLATE_SETTINGS } = await import('@/lib/translate-settings');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

/** The content is portalled to `document.body`, so assertions read the document. */
function open(overrides: Partial<TranslateSettings> = {}) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <DisplaySettingsPopover
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          onChange={() => {}}
        />
      </LocaleProvider>,
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label]');
  act(() => trigger?.click());
  return trigger;
}

const text = () => document.body.textContent ?? '';

describe('DisplaySettingsPopover', () => {
  it('names its trigger for what it now holds', () => {
    const trigger = open();
    expect(trigger?.getAttribute('aria-label')).toBe('Display settings');
  });

  it('holds every control that is about the page', () => {
    open();
    for (const label of [
      'Speaker labels',
      'Translation only',
      'Free scroll',
      'Display mode',
      'Text size',
      'Layout',
    ]) {
      expect(text()).toContain(label);
    }
  });

  it('holds nothing about the voice', () => {
    open();

    expect(document.querySelector('button[aria-label="Speak the translation aloud"]')).toBeNull();
    expect(document.querySelector('[aria-label="Playback volume"]')).toBeNull();
    expect(text()).not.toContain('Speed');
  });

  it('drops the pane orientation when there are no panes', () => {
    // `list` is one stream. A Row/Column control over it is a control that
    // accepts the press and changes nothing.
    open({ displayMode: 'list' });
    expect(text()).toContain('Display mode');
    expect(text()).not.toContain('Layout');
  });

  it('drops the arrangement entirely when only one side is shown', () => {
    open({ translationOnly: true });
    expect(text()).not.toContain('Display mode');
    expect(text()).not.toContain('Layout');
    // The three that still mean something stay.
    expect(text()).toContain('Speaker labels');
    expect(text()).toContain('Text size');
  });

  it('disables nothing, because nothing here reaches the session', () => {
    // The counterpart to the voice panel, where `running` fixes almost every row.
    // Everything here is applied at render in this browser, so a conversation in
    // progress changes none of it — and a disabled row would say otherwise.
    open();
    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content?.querySelectorAll('button[disabled], [data-disabled]').length).toBe(0);
  });

  it('does not name the direction, which the panel headers already do', () => {
    open();

    // The direction is on the surface now, in two headers that are always
    // visible; repeating it here would put the authoritative statement of "which
    // way is this translating" behind a gear again.
    expect(document.querySelector('button[aria-label^="Swap direction"]')).toBeNull();
  });

  it('takes its surface from the popover rather than bringing one', () => {
    open();

    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    // The panel returned a `Card` while the popover was its only mount, which
    // would now draw a bordered card inside a bordered popover.
    expect(content?.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('leaves the page underneath reachable', () => {
    open();

    // Radix marks the rest of the document `aria-hidden` only for a MODAL surface.
    // A popover over a live conversation must not: the transcript is the thing
    // being read while the settings are open.
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });
});
