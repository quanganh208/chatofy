// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_STORAGE_KEY,
  forgetStoredWorkspace,
  readStoredWorkspace,
  subscribeStoredWorkspace,
  writeStoredWorkspace,
} from './workspace-store';

/** The workspace choice belongs to one account on this device, and to this tab's writes. */
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the stored workspace', () => {
  it('is personal when nothing is stored', () => {
    expect(readStoredWorkspace('a')).toBe('personal');
  });

  it('reads back what the same user wrote', () => {
    writeStoredWorkspace('a', 'team-1');
    expect(readStoredWorkspace('a')).toBe('team-1');
  });

  it("ignores another user's entry", () => {
    writeStoredWorkspace('a', 'team-1');
    expect(readStoredWorkspace('b')).toBe('personal');
  });

  it('returns to personal once forgotten', () => {
    writeStoredWorkspace('a', 'team-1');
    forgetStoredWorkspace();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(readStoredWorkspace('a')).toBe('personal');
  });

  it('is personal when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredWorkspace('a')).toBe('personal');
  });

  it('notifies on its own writes but not on another tab’s storage event', () => {
    const listener = vi.fn();
    const stop = subscribeStoredWorkspace(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: WORKSPACE_STORAGE_KEY }));
    expect(listener).not.toHaveBeenCalled();
    writeStoredWorkspace('a', 'team-1');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
