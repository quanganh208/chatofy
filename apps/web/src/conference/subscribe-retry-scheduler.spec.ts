import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CONSECUTIVE_SUBSCRIBE_RETRIES,
  SubscribeRetryScheduler,
} from './subscribe-retry-scheduler';

describe('SubscribeRetryScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again once the reply’s delay has passed', () => {
    const retry = vi.fn();
    const scheduler = new SubscribeRetryScheduler(retry);
    scheduler.completed(1000);
    vi.advanceTimersByTime(999);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('does nothing for a reply that skipped nothing', () => {
    const retry = vi.fn();
    new SubscribeRetryScheduler(retry).completed(undefined);
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps one retry pending at a time', () => {
    const retry = vi.fn();
    const scheduler = new SubscribeRetryScheduler(retry);
    scheduler.completed(1000);
    scheduler.completed(1000);
    vi.runAllTimers();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('stops after the consecutive cap and starts over once a reply skips nothing', () => {
    const retry = vi.fn();
    const scheduler = new SubscribeRetryScheduler(retry);
    for (let i = 0; i < MAX_CONSECUTIVE_SUBSCRIBE_RETRIES + 2; i++) {
      scheduler.completed(500);
      vi.runAllTimers();
    }
    expect(retry).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SUBSCRIBE_RETRIES);

    scheduler.completed(undefined);
    scheduler.completed(500);
    vi.runAllTimers();
    expect(retry).toHaveBeenCalledTimes(MAX_CONSECUTIVE_SUBSCRIBE_RETRIES + 1);
  });

  it('drops a pending retry on cancel and schedules none after it', () => {
    const retry = vi.fn();
    const scheduler = new SubscribeRetryScheduler(retry);
    scheduler.completed(1000);
    scheduler.cancel();
    scheduler.completed(1000);
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();
  });
});
