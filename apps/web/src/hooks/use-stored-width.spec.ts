// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStoredWidth } from './use-stored-width';

/**
 * A panel width the reader chose, remembered per browser.
 *
 * It starts at the default on the server and on the first client render so the two agree,
 * then adopts the stored value. A stored value that is garbage or out of range is
 * ignored or clamped rather than trusted: this is read from storage the page does not
 * control.
 */
let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useStoredWidth>;

function Probe({ min = 200, max = 360 }: { min?: number; max?: number | (() => number) }) {
  const value = useStoredWidth('test.width', 256, min, max);
  // In an effect, not during render — see `use-translate-settings.spec.tsx`.
  useEffect(() => {
    current = value;
  });
  return null;
}

function mount(props: { min?: number; max?: number | (() => number) } = {}) {
  act(() => root.render(createElement(Probe, props)));
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useStoredWidth', () => {
  it('uses the default when nothing is stored', () => {
    mount();
    expect(current.width).toBe(256);
    expect(current.isCustom).toBe(false);
    expect(current.ready).toBe(true);
  });

  it('adopts a stored width', () => {
    localStorage.setItem('test.width', '300');
    mount();
    expect(current.width).toBe(300);
    expect(current.isCustom).toBe(true);
  });

  it('clamps a stored width that is out of range', () => {
    localStorage.setItem('test.width', '9000');
    mount();
    expect(current.width).toBe(360);
  });

  it('ignores a stored value that is not a number', () => {
    localStorage.setItem('test.width', 'wide');
    mount();
    expect(current.width).toBe(256);
    expect(current.isCustom).toBe(false);
  });

  it('stores and clamps a new width', () => {
    mount();
    act(() => current.setWidth(320));
    expect(current.width).toBe(320);
    expect(localStorage.getItem('test.width')).toBe('320');
    act(() => current.setWidth(10));
    expect(current.width).toBe(200);
  });

  it('forgets the choice on reset', () => {
    localStorage.setItem('test.width', '300');
    mount();
    act(() => current.reset());
    expect(current.width).toBe(256);
    expect(current.isCustom).toBe(false);
    expect(localStorage.getItem('test.width')).toBeNull();
  });

  it('accepts a limit that depends on the window', () => {
    mount({ max: () => 280 });
    act(() => current.setWidth(500));
    expect(current.width).toBe(280);
  });
});
