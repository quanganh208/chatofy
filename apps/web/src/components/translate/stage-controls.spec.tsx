// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/provider';
import { StageControls } from './stage-controls';

/**
 * The two icon-only buttons beside the display gear carry an accessible name but no
 * visible word, so a sighted new user had to guess what an arrow-out icon does. The
 * name is repeated as a hover and long-press tooltip.
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
  it('shows each button name as a tooltip as well as an accessible name', () => {
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
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      const name = button.getAttribute('aria-label');
      expect(name).toBeTruthy();
      expect(button.getAttribute('title')).toBe(name);
    }
  });
});
