// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';
import { StageControls } from './stage-controls';

/**
 * Outline buttons, not ghost: grey icons beside Start read as disabled. Each shows its
 * word above the dock's wide breakpoint and keeps an accessible name that contains it.
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
});

describe('StageControls', () => {
  it('renders outline buttons whose accessible name contains the visible word', () => {
    act(() => {
      root.render(
        <LocaleProvider locale="en">
          <StageControls
            onFullscreen={vi.fn()}
            windowKind="pip"
            windowOpen
            onToggleWindow={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect(button.getAttribute('data-variant')).toBe('outline');
      expect(button.className).toContain('text-foreground');
      const word = button.querySelector('span')?.textContent;
      expect(word).toBeTruthy();
      expect(button.getAttribute('aria-label')).toContain(word);
    }
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Full screen');
    expect(buttons[1]?.getAttribute('aria-label')).toMatch(/^Captions: /);
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  /**
   * The tooltip portals outside the dock's container, so it decides for itself
   * whether the word is on screen: open only while it is hidden, and then saying
   * the whole name — which window the caption button opens, not just "Captions".
   */
  function renderControls() {
    act(() => {
      root.render(
        <LocaleProvider locale="en">
          <StageControls
            onFullscreen={vi.fn()}
            windowKind="pip"
            windowOpen={false}
            onToggleWindow={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    return [...container.querySelectorAll('button')];
  }

  const tooltipText = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;

  it('opens no tooltip while the word is showing beside the icon', () => {
    const [, captions] = renderControls();
    act(() => captions?.focus());
    expect(tooltipText()).toBeNull();
  });

  it('names the whole window in the tooltip while the word is hidden', () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return element.tagName === 'SPAN' ? { ...style, display: 'none' } : style;
    });
    try {
      const [, captions] = renderControls();
      act(() => captions?.focus());
      expect(tooltipText()).toBe('Captions: Picture-in-picture');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
