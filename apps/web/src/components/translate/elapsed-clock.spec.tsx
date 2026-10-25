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
        <ElapsedClock startedAt={startedAt} pauses={[]} />
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
          <ElapsedClock startedAt="not-an-instant" pauses={[]} />
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

  describe('while paused', () => {
    const START = new Date('2026-09-07T10:00:00.000Z').getTime();
    function renderAt(pauses: { startedAt: number; endedAt: number | null }[]) {
      act(() => {
        root.render(
          <LocaleProvider>
            <ElapsedClock startedAt={new Date(START).toISOString()} pauses={pauses} />
          </LocaleProvider>,
        );
      });
    }

    it('holds still from the moment the pause began', () => {
      vi.setSystemTime(START + 65_000);
      renderAt([{ startedAt: START + 60_000, endedAt: null }]);
      expect(text()).toBe('1:00');

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(text()).toBe('1:00');
    });

    it('picks up where it stopped on resume, without stepping back', () => {
      vi.setSystemTime(START + 60_000);
      renderAt([]);
      vi.setSystemTime(START + 60_500);
      renderAt([{ startedAt: START + 60_500, endedAt: null }]);

      // Resumed five seconds later. No tick has run since before the pause, so
      // a clock reading at its last tick would take the pause off a moment
      // before it and show 0:55.
      vi.setSystemTime(START + 65_500);
      renderAt([{ startedAt: START + 60_500, endedAt: START + 65_500 }]);
      expect(text()).toBe('1:00');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(text()).toBe('1:01');
    });

    it('leaves every finished pause out of the reading', () => {
      vi.setSystemTime(START + 125_000);
      renderAt([
        { startedAt: START + 10_000, endedAt: START + 20_000 },
        { startedAt: START + 40_000, endedAt: START + 60_000 },
      ]);
      expect(text()).toBe('1:35');
    });
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
