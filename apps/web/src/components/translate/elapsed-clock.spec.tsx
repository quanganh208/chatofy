// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElapsedClock } from './elapsed-clock';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The clock reads from `startedAt` on every tick rather than counting its own
 * ticks. That is what these tests are really about: a counter that incremented
 * itself would drift whenever the tab was throttled — which is most of a long
 * conversation in a background tab — and would then disagree with the duration
 * stored for the same conversation.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** Fix "now", then start the conversation `secondsAgo` before it. */
function renderStartedSecondsAgo(secondsAgo: number | null) {
  const now = new Date('2026-09-07T10:00:00.000Z');
  vi.setSystemTime(now);
  const startedAt =
    secondsAgo === null ? null : new Date(now.getTime() - secondsAgo * 1000).toISOString();

  act(() => {
    root.render(
      <LocaleProvider>
        <ElapsedClock startedAt={startedAt} />
      </LocaleProvider>,
    );
  });
  return container;
}

const text = () => container.textContent;

describe('ElapsedClock', () => {
  it('shows nothing before a conversation has started', () => {
    renderStartedSecondsAgo(null);
    expect(text()).toBe('');
  });

  it('reads the elapsed time from the start instant, not from a paint', () => {
    renderStartedSecondsAgo(65);
    // Mounted 65s in and correct on the FIRST frame: a clock that started at
    // zero would tell a reader who reloaded that the conversation just began.
    expect(text()).toBe('1:05');
  });

  it('advances once a second', () => {
    renderStartedSecondsAgo(65);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toBe('1:06');
  });

  it('widens to hours only once there is an hour to show', () => {
    renderStartedSecondsAgo(3665);
    expect(text()).toBe('1:01:05');
  });

  it('reads 0:00 rather than NaN when the stored instant is unusable', () => {
    // Reachable without a bug here: the value survives a reload, and a client
    // clock can move backwards under it.
    act(() => {
      root.render(
        <LocaleProvider>
          <ElapsedClock startedAt="not-an-instant" />
        </LocaleProvider>,
      );
    });
    expect(text()).toBe('0:00');
  });

  it('is named once and does not announce every second', () => {
    renderStartedSecondsAgo(5);
    const clock = container.querySelector('[aria-label]')!;
    expect(clock).not.toBeNull();
    // A number re-announcing itself every second would talk over the transcript.
    expect(clock.getAttribute('aria-live')).toBeNull();
  });

  it('stops its timer when unmounted', () => {
    renderStartedSecondsAgo(5);
    const clear = vi.spyOn(globalThis, 'clearInterval');
    act(() => root.unmount());
    expect(clear).toHaveBeenCalled();
    // The teardown in `afterEach` must not unmount twice.
    root = createRoot(container);
  });
});
