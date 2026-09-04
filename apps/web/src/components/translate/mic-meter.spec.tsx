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

/**
 * Each bar's height at a given level, as a NUMBER.
 *
 * happy-dom does not resolve `calc()`, so the expression is evaluated here — the
 * assertions are about which bar is taller, and a comparison over strings is not
 * that comparison.
 */
function drawn(level: number): number[] {
  render(level);
  return heights().map((height) => {
    const [, base, span, value, factor] =
      /calc\((\d+)px \+ (\d+)px \* ([\d.]+) \* ([\d.]+)\)/.exec(height) ?? [];
    return Number(base) + Number(span) * Number(value) * Number(factor);
  });
}

describe('MicMeter', () => {
  it('is in the accessibility tree with a name and a value', () => {
    // It used to be `role="presentation"`: the one control that answers "can it
    // hear me?" was not reported at all.
    const meter = render(0.2);
    expect(meter.getAttribute('aria-label')).toBe('Microphone level');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
  });

  it('grows with the signal — every bar, in the right direction', () => {
    // Asserted as an ORDER over resolved numbers, not as "the strings differ".
    // A meter wired backwards — loud drawn flat, silence drawn full — satisfies
    // "these two renders are not equal", produces `calc(...)` for both, and
    // starts every bar at the 4px floor. All three of the assertions this
    // replaced passed with the mapping inverted.
    const quiet = drawn(0.05);
    const loud = drawn(0.25);

    expect(quiet.length).toBe(7);
    for (const [index, tall] of loud.entries()) {
      expect(tall, `bar ${index} did not grow with the signal`).toBeGreaterThan(quiet[index]!);
    }
  });

  it('says loudness in neutral ink, spending no accent on a readout', () => {
    // It replaced a `bg-primary` filled track. The live hue is already carried by
    // the status dot beside it, so a meter in the accent colour spent the screen's
    // loudest colour on something that is not an action.
    render(0.5);
    const bar = container.querySelector('[role="meter"] > span');
    expect(bar?.className).toContain('bg-muted-foreground');
    expect(bar?.className).not.toContain('bg-primary');
  });

  it('carries no keyframe, so a motion preference cannot switch it off', () => {
    // The whole reason the height is data. An animation would be removed entirely
    // by `prefers-reduced-motion`, leaving that reader with no microphone feedback
    // at all; a driven height only stops easing.
    render(0.5);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.innerHTML).not.toContain('animate-');
    const bar = container.querySelector('[role="meter"] > span');
    expect(bar?.className).toContain('motion-reduce:transition-none');
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
