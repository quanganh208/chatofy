// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '../entrypoints/content/overlay';
import type { OverlayState } from './messages';

/**
 * The collapsed pill carries the lotus only while nothing is being captured.
 *
 * The pulsing dot on the red pill IS the recording indicator, so the mark must
 * never stand in for it: a logo in that slot would make a live capture look like
 * an idle extension. Asserted on the built DOM rather than the source, because
 * the rule is about which element is visible in which state.
 */

vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });

function mount(): { overlay: Overlay; root: ShadowRoot } {
  // The root is closed, so the page — and this spec — cannot reach it afterwards.
  // Spying on the call that creates it (and letting it through) is the one way in.
  const spy = vi.spyOn(Element.prototype, 'attachShadow');
  const overlay = new Overlay();
  const root = spy.mock.results[0]?.value as ShadowRoot | undefined;
  spy.mockRestore();
  if (!root) throw new Error('the overlay attached no shadow root');
  return { overlay, root };
}

const idle: OverlayState = { capturing: false, lines: [], outbound: 'off', errors: {} };

afterEach(() => {
  document.body.replaceChildren();
});

describe('overlay pill', () => {
  it('leads with the lotus, built as SVG nodes, while idle', () => {
    const { root } = mount();
    const pill = root.querySelector('.pill');
    const mark = root.querySelector<HTMLElement>('.pill-mark');
    expect(pill?.classList.contains('live')).toBe(false);
    expect(mark?.hidden).toBe(false);
    expect(mark?.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(mark?.querySelectorAll('svg path')).toHaveLength(4);
    expect(root.querySelector<HTMLElement>('.pill-dot')?.hidden).toBe(true);
  });

  it('swaps the mark for the pulsing dot while capturing', () => {
    const { overlay, root } = mount();
    overlay.render({ ...idle, capturing: true });
    expect(root.querySelector('.pill')?.classList.contains('live')).toBe(true);
    expect(root.querySelector<HTMLElement>('.pill-mark')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.pill-dot')?.hidden).toBe(false);
  });

  it('brings the mark back once capture stops', () => {
    const { overlay, root } = mount();
    overlay.render({ ...idle, capturing: true });
    overlay.render(idle);
    expect(root.querySelector<HTMLElement>('.pill-mark')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.pill-dot')?.hidden).toBe(true);
  });
});
