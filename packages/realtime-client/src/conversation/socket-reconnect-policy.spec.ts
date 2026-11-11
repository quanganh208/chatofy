import { describe, expect, it } from 'vitest';
import { RECONNECT_DELAYS_MS, reconnectDelay } from './socket-reconnect-policy.js';

describe('reconnectDelay', () => {
  it('follows the schedule with no jitter at the midpoint', () => {
    expect([1, 2, 3].map((attempt) => reconnectDelay(attempt, () => 0.5))).toEqual([
      ...RECONNECT_DELAYS_MS,
    ]);
  });

  it('jitters within ±20%', () => {
    expect(reconnectDelay(1, () => 0)).toBe(400);
    expect(reconnectDelay(1, () => 1)).toBe(600);
  });

  it('gives up after the last attempt', () => {
    expect(reconnectDelay(4, () => 0.5)).toBeNull();
    expect(reconnectDelay(0, () => 0.5)).toBeNull();
  });
});
