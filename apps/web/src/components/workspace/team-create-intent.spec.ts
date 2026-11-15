import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeTeamCreateIntent,
  INTENT_TTL_MS,
  requestTeamCreateForm,
} from './team-create-intent';

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('team create intent', () => {
  it('answers false with no request', () => {
    vi.useFakeTimers();
    expect(consumeTeamCreateIntent()).toBe(false);
  });

  it('answers true for every read in the tick it is consumed, then never again', () => {
    vi.useFakeTimers();
    requestTeamCreateForm();
    // StrictMode reads twice in one tick; both must see the request.
    expect(consumeTeamCreateIntent()).toBe(true);
    expect(consumeTeamCreateIntent()).toBe(true);
    vi.runAllTimers();
    expect(consumeTeamCreateIntent()).toBe(false);
  });

  it('expires when nobody consumes it in time', () => {
    vi.useFakeTimers();
    requestTeamCreateForm();
    vi.advanceTimersByTime(INTENT_TTL_MS + 1);
    expect(consumeTeamCreateIntent()).toBe(false);
  });
});
