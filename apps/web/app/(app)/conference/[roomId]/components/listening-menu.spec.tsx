// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';
import { ListeningMenu } from './listening-menu';

/**
 * Captions and sound, inside the call. Competing meeting products let each person decide
 * what they read and how loud the original speaker is next to the translation: Google
 * Meet's caption settings, Zoom's original-voice balance, Wordly's listen-or-read choice.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((n) => n.remove());
});

function open(prefs = { captions: true, captionSize: 'md' as const, originalVolume: 1 }) {
  const update = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider locale="en">
        <ListeningMenu prefs={prefs} onChange={update} />
      </LocaleProvider>,
    );
  });
  const trigger = container.querySelector('button[aria-label="Captions and sound"]');
  expect(trigger, 'the menu button is missing').not.toBeNull();
  act(() => {
    trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
  });
  return update;
}

describe('ListeningMenu', () => {
  it('shows the captions switch, the size choice and the original-voice volume', () => {
    open();
    expect(document.querySelector('[role="switch"][aria-label="Show captions"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="radio"]').length).toBe(4);
    expect(document.querySelector('[role="slider"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Lower this to hear the translation more clearly.');
  });

  it('turns captions off from the switch', () => {
    const update = open();
    const sw = document.querySelector<HTMLElement>('[role="switch"][aria-label="Show captions"]');
    act(() => sw!.click());
    expect(update).toHaveBeenCalledWith({ captions: false });
  });

  it('picks a caption size', () => {
    const update = open();
    const xl = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (r) => r.textContent === 'XL',
    );
    expect(xl, 'XL option missing').toBeTruthy();
    act(() => xl!.click());
    expect(update).toHaveBeenCalledWith({ captionSize: 'xl' });
  });

  it('disables the size choice while captions are off', () => {
    open({ captions: false, captionSize: 'md', originalVolume: 1 });
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.length).toBe(4);
    expect(
      radios.every((r) => r.hasAttribute('disabled') || r.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
  });
});
