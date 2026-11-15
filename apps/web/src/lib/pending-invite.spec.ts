// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingInvite,
  readPendingInvite,
  rememberJoinedTeam,
  savePendingInvite,
  takeJoinedTeam,
} from './pending-invite';

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

  it('stays readable once parked, but no longer awaits a sign-in', async () => {
    const { hasInviteAwaitingSignIn, parkPendingInvite } = await import('./pending-invite');
    savePendingInvite(TOKEN);
    expect(hasInviteAwaitingSignIn()).toBe(true);
    parkPendingInvite();
    expect(readPendingInvite()).toBe(TOKEN);
    expect(hasInviteAwaitingSignIn()).toBe(false);
  });

  it('is gone once cleared', () => {
    savePendingInvite(TOKEN);
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });
});

describe('the joined-team hand-off', () => {
  beforeEach(() => sessionStorage.clear());

  it('is read once, then gone', () => {
    rememberJoinedTeam('Cardiology unit');
    expect(takeJoinedTeam()).toBe('Cardiology unit');
    expect(takeJoinedTeam()).toBeNull();
  });

  it('is nothing when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(takeJoinedTeam()).toBeNull();
    vi.restoreAllMocks();
  });
});
