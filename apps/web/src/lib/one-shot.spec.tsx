// @vitest-environment happy-dom
import { act, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOneShot } from './one-shot';

afterEach(() => {
  vi.useRealTimers();
});

describe('createOneShot', () => {
  it('answers false with no request', () => {
    expect(createOneShot(1_000).consume()).toBe(false);
  });

  it('answers true once per request, then false', () => {
    const shot = createOneShot(1_000);
    shot.request();
    expect(shot.consume()).toBe(true);
    expect(shot.consume()).toBe(false);
  });

  it('answers true at the TTL and false just past it, clearing either way', () => {
    vi.useFakeTimers();
    const shot = createOneShot(1_000);
    shot.request();
    vi.advanceTimersByTime(1_000);
    expect(shot.consume()).toBe(true);
    shot.request();
    vi.advanceTimersByTime(1_001);
    expect(shot.consume()).toBe(false);
    expect(shot.consume()).toBe(false);
  });

  it('keeps the first read when a StrictMode useState initializer runs twice', () => {
    const shot = createOneShot(1_000);
    const seen: boolean[] = [];
    function Reader() {
      const [value] = useState(shot.consume);
      seen.push(value);
      return null;
    }
    shot.request();
    const root = createRoot(document.createElement('div'));
    act(() =>
      root.render(
        <StrictMode>
          <Reader />
        </StrictMode>,
      ),
    );
    // Every render of the one mount sees the request; the request is gone after.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(shot.consume()).toBe(false);
    act(() => root.unmount());
  });
});
