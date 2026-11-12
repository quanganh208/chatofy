// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MicLevelMeter } from './mic-level-meter';

/**
 * The lobby's level bar moves many times a second. Driving `width` makes the browser lay
 * the page out on every frame; a `transform` does not. The value shown is the same.
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

function fill(level: number) {
  act(() => root.render(<MicLevelMeter level={level} label="Microphone level" />));
  return container.querySelector('[role="meter"] > div') as HTMLElement;
}

describe('MicLevelMeter', () => {
  it('scales the bar instead of resizing it, from the left edge', () => {
    const bar = fill(0.5);
    expect(bar.style.transform).toBe('scaleX(0.5)');
    expect(bar.style.width).toBe('');
    expect(bar.className).toContain('origin-left');
    expect(bar.className).toContain('w-full');
    expect(bar.className).not.toContain('transition-[width]');
  });

  it('still reports the level to assistive technology', () => {
    fill(0.25);
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('25');
  });

  it('clamps the level', () => {
    expect(fill(3).style.transform).toBe('scaleX(1)');
    expect(fill(-1).style.transform).toBe('scaleX(0)');
  });
});
