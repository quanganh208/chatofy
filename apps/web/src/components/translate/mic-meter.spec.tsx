// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MicMeter } from './mic-meter';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The meter reports a signal. Everything here is about it staying a REPORT: a
 * control that animated on a timer would look the same in a silent room, and one
 * switched off by reduced motion would leave that reader with nothing.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(level: number) {
  act(() => {
    root.render(
      <LocaleProvider>
        <MicMeter level={level} />
      </LocaleProvider>,
    );
  });
  return container.querySelector('[role="meter"]')!;
}

function heights(): string[] {
  return [...container.querySelectorAll('[role="meter"] > span')].map(
    (bar) => (bar as HTMLElement).style.height,
  );
}

describe('MicMeter', () => {
  it('is in the accessibility tree with a name and a value', () => {
    // It used to be `role="presentation"`: the one control that answers "can it
    // hear me?" was not reported at all.
    const meter = render(0.2);
    expect(meter.getAttribute('aria-label')).toBe('Microphone level');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
  });

  it('reports louder as taller, not as a different animation', () => {
    render(0);
    const quiet = heights();
    render(0.3);
    const loud = heights();

    expect(quiet).not.toEqual(loud);
    // The height is computed from the level in the style attribute, so it is a
    // value the browser reads — not a keyframe a motion preference can switch
    // off. Under reduced motion the transition drops and the height stays.
    expect(loud.every((h) => h.includes('calc('))).toBe(true);
  });

  it('rests at a floor rather than disappearing in a silent room', () => {
    render(0);
    // Every bar still has its 4px base: a meter at rest and a meter that is gone
    // are different facts.
    expect(heights().every((h) => h.startsWith('calc(4px'))).toBe(true);
  });

  it('clamps a hot signal instead of drawing past the top', () => {
    render(5);
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('draws seven bars, tallest in the middle', () => {
    render(1);
    const values = heights().map((h) => Number(/\* (\d*\.?\d+)\)$/.exec(h)?.[1] ?? 0));
    expect(values.length).toBe(7);
    expect(Math.max(...values)).toBe(values[3]);
    expect(values[0]).toBe(values[6]);
  });
});
