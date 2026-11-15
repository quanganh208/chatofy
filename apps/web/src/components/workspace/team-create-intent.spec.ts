import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAND_OFF_TTL_MS } from '@/lib/one-shot';
import { consumeTeamCreateIntent, requestTeamCreateForm } from './team-create-intent';

afterEach(() => {
  vi.useRealTimers();
});

describe('team create intent', () => {
  it('answers false with no request', () => {
    expect(consumeTeamCreateIntent()).toBe(false);
  });

  it('answers true for the first read after a request, then never again', () => {
    requestTeamCreateForm();
    expect(consumeTeamCreateIntent()).toBe(true);
    expect(consumeTeamCreateIntent()).toBe(false);
  });

  it('expires when nobody consumes it in time', () => {
    vi.useFakeTimers();
    requestTeamCreateForm();
    vi.advanceTimersByTime(HAND_OFF_TTL_MS + 1);
    expect(consumeTeamCreateIntent()).toBe(false);
  });
});
