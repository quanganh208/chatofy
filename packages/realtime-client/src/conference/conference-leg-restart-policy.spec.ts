import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegRestartPolicy, isRefusal } from './conference-leg-restart-policy.js';

function policy() {
  let now = 1_000;
  const restart = vi.fn();
  const logs: string[] = [];
  const p = new LegRestartPolicy({ restart, log: (m) => logs.push(m), now: () => now });
  return {
    p,
    restart,
    logs,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const drop = { closeCode: 1006, beforeSocket: false };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('isRefusal', () => {
  it.each([
    [1008, true],
    [4000, true],
    [4410, true],
    [4999, true],
    [1000, false],
    [1006, false],
    [5000, false],
    [null, false],
  ])('%s -> %s', (code, refused) => {
    expect(isRefusal(code)).toBe(refused);
  });
});

describe('LegRestartPolicy', () => {
  it('rebuilds after 1, 2 and 4 seconds, then gives up', () => {
    const h = policy();
    for (const delay of [1_000, 2_000, 4_000]) {
      expect(h.p.stopped(drop)).toBeNull();
      vi.advanceTimersByTime(delay - 1);
      const before = h.restart.mock.calls.length;
      vi.advanceTimersByTime(1);
      expect(h.restart).toHaveBeenCalledTimes(before + 1);
    }

    expect(h.p.stopped(drop)).toBe('retries_exhausted');
    vi.advanceTimersByTime(60_000);
    expect(h.restart).toHaveBeenCalledTimes(3);
  });

  it('ends at once on a refusal close, without a rebuild', () => {
    const h = policy();

    expect(h.p.stopped({ closeCode: 4410, beforeSocket: false })).toBe('refused');
    vi.advanceTimersByTime(10_000);
    expect(h.restart).not.toHaveBeenCalled();
  });

  it('ends at once when the start failed before any socket', () => {
    const h = policy();

    expect(h.p.stopped({ closeCode: null, beforeSocket: true })).toBe('start_failed');
    vi.advanceTimersByTime(10_000);
    expect(h.restart).not.toHaveBeenCalled();
  });

  it('retries a failure after the socket was opened even with no close code', () => {
    const h = policy();

    expect(h.p.stopped({ closeCode: null, beforeSocket: false })).toBeNull();
  });

  it('starts a fresh budget once a session was live for over a minute', () => {
    const h = policy();
    h.p.stopped(drop);
    h.p.stopped(drop);
    h.p.stopped(drop);
    h.p.attempting();
    h.p.live();
    h.advance(61_000);

    expect(h.p.stopped(drop)).toBeNull();
    expect(h.logs.at(-1)).toContain('in 1000ms');
  });

  it('keeps spending the budget for a session that never went live', () => {
    const h = policy();
    h.p.stopped(drop);
    h.p.stopped(drop);
    h.p.stopped(drop);
    h.p.attempting();
    h.advance(61_000);

    expect(h.p.stopped(drop)).toBe('retries_exhausted');
  });

  it('forgets a pending rebuild on cancel', () => {
    const h = policy();
    h.p.stopped(drop);
    h.p.cancel();
    vi.advanceTimersByTime(10_000);

    expect(h.restart).not.toHaveBeenCalled();
  });
});
