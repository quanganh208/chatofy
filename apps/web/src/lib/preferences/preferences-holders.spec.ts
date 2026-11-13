// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountHolder,
  createVisitorHolder,
  type AccountHolder,
} from './preferences-holders';
import { fakePreferencesServer, type FakePreferencesServer } from './preferences.fixture';
import { PREFERENCES_CACHE_KEY } from './preferences-cache';

/** Real timers: BroadcastChannel delivers between instances on the event loop. */
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

let server: FakePreferencesServer;
const open: AccountHolder[] = [];

function tab(userId = 'user-1'): AccountHolder {
  const holder = createAccountHolder({
    userId,
    locale: 'en',
    transport: server.transport,
    debounceMs: 5,
  });
  holder.confirm();
  open.push(holder);
  return holder;
}

beforeEach(() => {
  localStorage.clear();
  server = fakePreferencesServer();
});

afterEach(() => {
  for (const holder of open.splice(0)) holder.dispose(false);
  vi.restoreAllMocks();
});

describe('an account holder', () => {
  it('sends nothing before the session confirms the account', async () => {
    const load = vi.spyOn(server.transport, 'load');
    const holder = createAccountHolder({ userId: 'u', locale: 'en', transport: server.transport });
    open.push(holder);
    await tick();
    expect(load).not.toHaveBeenCalled();
    expect(holder.getSnapshot().ready).toBe(false);

    holder.confirm();
    await tick();
    expect(load).toHaveBeenCalledOnce();
    expect(holder.getSnapshot().ready).toBe(true);
  });

  it("hands a saved change to the account's other tabs in this browser", async () => {
    const first = tab();
    const second = tab();
    await tick();

    first.update({ theme: 'dark' });
    await tick(60);
    expect(server.stored().theme).toBe('dark');
    expect(second.getSnapshot().preferences.theme).toBe('dark');
  });

  it("ignores another account's tab", async () => {
    const mine = tab('user-1');
    tab('user-2').update({ theme: 'dark' });
    await tick(60);
    expect(mine.getSnapshot().preferences.theme).toBe('system');
  });

  it('caches what it holds under its own account', async () => {
    tab('user-1').update({ translateMode: 'two-way' });
    await tick();
    const cached = JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY)!) as {
      userId: string;
      preferences: { translateMode: string };
    };
    expect(cached.userId).toBe('user-1');
    expect(cached.preferences.translateMode).toBe('two-way');
  });
});

describe('a visitor holder', () => {
  it('stores a theme and nothing else', () => {
    const visitor = createVisitorHolder('en');
    visitor.update({ theme: 'light', translateMode: 'two-way' });
    expect(visitor.getSnapshot().preferences.translateMode).toBe('two-way');
    expect(JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY)!)).toEqual({
      userId: null,
      preferences: { theme: 'light' },
    });
    expect(createVisitorHolder('en').getSnapshot().preferences).toMatchObject({
      theme: 'light',
      translateMode: 'one-way',
    });
  });

  it('is not ready while it stands in for a session still loading', () => {
    expect(createVisitorHolder('en', true).getSnapshot().ready).toBe(false);
    expect(createVisitorHolder('en').getSnapshot().ready).toBe(true);
  });
});
