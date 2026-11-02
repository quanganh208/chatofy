// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmoothTextReveal } from './use-smooth-text-reveal';

let container: HTMLDivElement;
let root: Root;

function Probe({ target, hold = false }: { target: string; hold?: boolean }) {
  const { shown, attach } = useSmoothTextReveal(target, {
    initialIntervalMs: 300,
    holdWhilePrefix: hold,
  });
  return (
    <span data-testid="probe" ref={attach}>
      {shown}
    </span>
  );
}

const probe = () => container.querySelector('[data-testid="probe"]')!.textContent;
const render = (target: string, hold = false): void => {
  act(() => {
    root.render(<Probe target={target} hold={hold} />);
  });
};
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'setTimeout',
      'clearTimeout',
    ],
  });
  stubReducedMotion(false);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSmoothTextReveal', () => {
  it('starts empty and types the whole line in', () => {
    render('xin chào bạn');
    expect(probe()).toBe('');
    advance(1000);
    expect(probe()).toBe('xin chào bạn');
  });

  it('is part of the way through after a few frames', () => {
    render('xin chào bạn');
    advance(50);
    const shown = probe();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan('xin chào bạn'.length);
    expect('xin chào bạn'.startsWith(shown)).toBe(true);
  });

  it('draws at once and schedules nothing under reduced motion', () => {
    stubReducedMotion(true);
    render('xin chào bạn');
    expect(probe()).toBe('xin chào bạn');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws at once in a hidden document, whose frames would not run', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    render('xin chào bạn');
    expect(probe()).toBe('xin chào bạn');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes the line when the document is hidden mid-reveal', () => {
    render('xin chào bạn');
    advance(30);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(probe()).toBe('xin chào bạn');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks the drawing element's own window for frames", () => {
    // happy-dom has one window, so this pins the call path rather than a second
    // document: the frame is requested through `ownerDocument.defaultView`.
    const spy = vi.spyOn(window, 'requestAnimationFrame');
    render('xin chào');
    expect(spy).toHaveBeenCalled();
  });

  it('removes a retracted word in the same render, then types the correction', () => {
    render('xin chào bạn');
    advance(1000);
    render('xin chào các bạn');
    expect(probe()).toBe('xin chào ');
    advance(1000);
    expect(probe()).toBe('xin chào các bạn');
  });

  it('keeps a held translation on screen', () => {
    render('Hello my friend', true);
    advance(1000);
    render('Hello', true);
    expect(probe()).toBe('Hello my friend');
  });

  it('leaves no frame pending after unmounting mid-reveal', () => {
    render('xin chào bạn');
    advance(30);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});
