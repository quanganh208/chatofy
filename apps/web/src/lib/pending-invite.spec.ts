// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingInvite, readPendingInvite, savePendingInvite } from './pending-invite';

/** A token taken out of the `/invite` URL survives register and verify, for 7 days. */
const TOKEN = 'A'.repeat(42) + '_';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the pending invite', () => {
  it('reads back a saved token', () => {
    savePendingInvite(TOKEN);
    expect(readPendingInvite()).toBe(TOKEN);
  });

  it('is ignored after 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    savePendingInvite(TOKEN);
    vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    expect(readPendingInvite()).toBeNull();
  });

  it('ignores a malformed token', () => {
    savePendingInvite('not-a-token');
    expect(readPendingInvite()).toBeNull();
  });

  it('is gone once cleared', () => {
    savePendingInvite(TOKEN);
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });
});
