// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '../entrypoints/content/overlay';
import { t } from './i18n';
import type { OverlayState } from './messages';

/**
 * One line per failure, and the two microphone failures are separate lines.
 *
 * `outbound` (the offscreen leg) and `relay` (the worker's hand-off into the page)
 * recover independently, so showing one of them in place of the other would hide
 * a failure that is still true.
 */

vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });

function mount(): { overlay: Overlay; root: ShadowRoot } {
  // The root is closed; spying on the call that creates it is the one way in.
  const spy = vi.spyOn(Element.prototype, 'attachShadow');
  const overlay = new Overlay();
  const root = spy.mock.results[0]?.value as ShadowRoot | undefined;
  spy.mockRestore();
  if (!root) throw new Error('the overlay attached no shadow root');
  return { overlay, root };
}

const live = (errors: OverlayState['errors']): OverlayState => ({
  capturing: true,
  lines: [],
  outbound: 'sending',
  errors,
});

const errorLines = (root: ShadowRoot) =>
  [...root.querySelectorAll('.error span')].map((line) => line.textContent);

afterEach(() => {
  document.body.replaceChildren();
});

describe('overlay error lines', () => {
  it('renders a relay failure with the microphone prefix', () => {
    const { overlay, root } = mount();

    overlay.render(live({ relay: 'tab lost' }));

    expect(root.querySelector<HTMLElement>('.error')?.hidden).toBe(false);
    expect(errorLines(root)).toEqual([
      t('extension.status.microphoneError', { error: 'tab lost' }),
    ]);
  });

  it('shows both microphone lines when outbound and relay both failed', () => {
    const { overlay, root } = mount();

    overlay.render(live({ outbound: 'mic refused', relay: 'tab lost' }));

    expect(errorLines(root)).toEqual([
      t('extension.status.microphoneError', { error: 'mic refused' }),
      t('extension.status.microphoneError', { error: 'tab lost' }),
    ]);
  });

  it('hides the box once the relay recovers', () => {
    const { overlay, root } = mount();
    overlay.render(live({ relay: 'tab lost' }));

    overlay.render(live({}));

    expect(root.querySelector<HTMLElement>('.error')?.hidden).toBe(true);
    expect(errorLines(root)).toEqual([]);
  });
});
