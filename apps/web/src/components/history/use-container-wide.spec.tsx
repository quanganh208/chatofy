// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContainerWide, WIDE_PROBE_CLASS } from './use-container-wide';

/**
 * "Wide" is whatever the container query says, never a px number.
 *
 * happy-dom has no stylesheet, so the probe's `display` is set inline here to stand
 * in for the `@5xl:block` rule. The case that matters is the disagreement: a
 * container reporting a width that a px threshold would call wide, while CSS — at a
 * larger root font size — has not switched.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resize: (width: number) => void = () => {};

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    resize = (width) =>
      this.callback(
        [{ target, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry],
        this,
      );
  }
  disconnect() {}
  unobserve() {}
}

let root: Root | undefined;
let container: HTMLElement;
let seen: boolean[];

function Probe() {
  const frame = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  seen.push(useContainerWide(frame, probe));
  return (
    <div ref={frame}>
      <div ref={probe} id="probe" className={WIDE_PROBE_CLASS} />
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  seen = [];
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const probe = () => container.querySelector<HTMLElement>('#probe')!;

describe('useContainerWide', () => {
  it('follows the container query, not the measured px', () => {
    // 1100px of content at a 20px root: a 1024px threshold says wide, CSS (64rem =
    // 1280px) does not. The hook must side with CSS.
    probe().style.display = 'none';
    act(() => resize(1100));
    expect(seen.at(-1)).toBe(false);

    probe().style.display = 'block';
    act(() => resize(1300));
    expect(seen.at(-1)).toBe(true);
  });

  it('switches back when the query stops matching', () => {
    probe().style.display = 'block';
    act(() => resize(1300));
    probe().style.display = 'none';
    act(() => resize(900));
    expect(seen.at(-1)).toBe(false);
  });

  it('starts narrow before anything is measured', () => {
    expect(seen[0]).toBe(false);
  });
});
