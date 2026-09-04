// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The gear holds the page, and nothing about sound.
 *
 * It used to hold both, which is the arrangement this file now guards against.
 * One icon at the end of the dock covered "what am I hearing" and "how is the
 * page arranged" while naming neither — and the speaker in the panel header, the
 * one element on the screen that is visibly about sound, configured nothing at
 * all. The voice lives with that header now.
 *
 * The failure mode if this drifts back is quiet: a voice row reappearing here
 * still works, so nothing breaks. The screen simply stops being able to tell you
 * where anything is.
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
function open() {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <DisplaySettingsPopover settings={DEFAULT_TRANSLATE_SETTINGS} onChange={() => {}} />
      </LocaleProvider>,
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label]');
  act(() => trigger?.click());
  return trigger;
}

describe('DisplaySettingsPopover', () => {
  it('names its trigger for what it now holds', () => {
    const trigger = open();
    expect(trigger?.getAttribute('aria-label')).toBe('Display settings');
  });

  it('holds the transcript layout', () => {
    open();
    expect(document.body.textContent).toContain('Columns');
    expect(document.body.textContent).toContain('Stacked');
  });

  it('holds nothing about the voice', () => {
    open();

    expect(document.querySelector('button[aria-label="Speak the translation aloud"]')).toBeNull();
    expect(document.querySelector('[aria-label="Playback volume"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Speed');
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
