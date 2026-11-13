// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserPreferences, mergePreferences, type UserPreferences } from '@chatofy/types';
import { LocaleProvider } from '@/i18n/provider';
import {
  PREFERENCES_CACHE_KEY,
  accountPreferencesCache,
  readCachedTheme,
} from '@/lib/preferences/preferences-cache';
import {
  fakePreferencesServer,
  type FakePreferencesServer,
} from '@/lib/preferences/preferences.fixture';

/**
 * Which preferences a page holds, and when the account's other devices reach it.
 *
 * The session and the API are stubbed; the sync store, the holders and the cache
 * are the real ones, against an in-memory server.
 */
interface SessionStub {
  data: { user: { id: string }; accessToken: string } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}
const session = vi.hoisted(() => ({
  value: { data: null, status: 'loading' } as SessionStub,
}));
vi.mock('next-auth/react', () => ({ useSession: () => session.value }));

const api = vi.hoisted(() => ({ server: null as FakePreferencesServer | null }));
vi.mock('@/clients/api-client', () => ({
  getPreferences: () => api.server!.transport.load(),
  updatePreferences: (patch: never) => api.server!.transport.save(patch),
  resetPreferences: () => api.server!.transport.reset(),
}));

const { PreferencesProvider } = await import('./preferences-provider');
const { usePreferences } = await import('@/hooks/use-preferences');
const { useReportConversationRunning } = await import('@/hooks/use-conversation-running');

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof usePreferences>;
let server: FakePreferencesServer;
let load: ReturnType<typeof vi.spyOn>;

function Probe({ running = false }: { running?: boolean }) {
  const value = usePreferences();
  useReportConversationRunning(running);
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function render(running = false) {
  act(() => {
    root.render(
      <LocaleProvider>
        <PreferencesProvider>
          <Probe running={running} />
        </PreferencesProvider>
      </LocaleProvider>,
    );
  });
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

function signedInAs(id: string) {
  session.value = { data: { user: { id }, accessToken: 't' }, status: 'authenticated' };
}

function onServer(patch: Parameters<typeof mergePreferences>[1]): UserPreferences {
  const next = mergePreferences(server.stored(), patch);
  server.setStored(next);
  return next;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.documentElement.className = '';
  server = fakePreferencesServer();
  api.server = server;
  load = vi.spyOn(server.transport, 'load');
  session.value = { data: null, status: 'loading' };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a signed-out visitor', () => {
  it("keeps only a theme, and forgets an account's copy left behind", async () => {
    void accountPreferencesCache('user-a').write({
      ...defaultUserPreferences('en'),
      theme: 'dark',
    });
    session.value = { data: null, status: 'unauthenticated' };
    render();
    await settle();

    expect(latest.synced).toBe(false);
    expect(latest.ready).toBe(true);
    expect(latest.preferences.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY)!)).toEqual({
      userId: null,
      preferences: { theme: 'dark' },
    });
    expect(load).not.toHaveBeenCalled();
    expect(document.documentElement.className).toBe('dark');
  });
});

describe('a signed-in reader', () => {
  it('opens from the cache while the session loads, and asks the server only once it confirms', async () => {
    void accountPreferencesCache('user-a').write({
      ...defaultUserPreferences('en'),
      theme: 'light',
    });
    onServer({ theme: 'dark' });
    render();
    await settle();

    expect(latest.ready).toBe(true);
    expect(latest.preferences.theme).toBe('light');
    expect(load).not.toHaveBeenCalled();

    signedInAs('user-a');
    render();
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(latest.preferences.theme).toBe('dark');
    expect(document.documentElement.className).toBe('dark');
  });

  it("ignores another account's cache and waits for its own", async () => {
    void accountPreferencesCache('user-b').write({
      ...defaultUserPreferences('en'),
      theme: 'light',
    });
    onServer({ theme: 'dark' });
    signedInAs('user-a');
    render();
    expect(latest.ready).toBe(false);

    await settle();
    expect(latest.ready).toBe(true);
    expect(latest.synced).toBe(true);
    expect(latest.preferences.theme).toBe('dark');
  });

  it('is not ready on a fresh browser until the account answers', async () => {
    render();
    await settle();
    expect(latest.ready).toBe(false);

    signedInAs('user-a');
    render();
    await settle();
    expect(latest.ready).toBe(true);
  });

  it('picks up a change made on another device when the tab is looked at again', async () => {
    signedInAs('user-a');
    render();
    await settle();

    onServer({ translateMode: 'two-way' });
    act(() => void window.dispatchEvent(new Event('focus')));
    await settle();
    expect(latest.preferences.translateMode).toBe('two-way');
  });

  it('keeps a remote change out while a conversation runs, and applies it after', async () => {
    signedInAs('user-a');
    render(true);
    await settle();

    onServer({ voices: { en: { speed: 1.5 } } });
    act(() => void window.dispatchEvent(new Event('focus')));
    await settle();
    expect(latest.preferences.voices.en).toBeUndefined();

    render(false);
    await settle();
    expect(latest.preferences.voices.en).toEqual({ speed: 1.5 });
  });

  it('sends a pending change when the browser comes back online', async () => {
    signedInAs('user-a');
    render();
    await settle();

    server.failing = true;
    act(() => latest.update({ theme: 'dark' }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(latest.status).toBe('error');

    server.failing = false;
    act(() => void window.dispatchEvent(new Event('online')));
    await settle();
    expect(latest.status).toBe('idle');
    expect(server.stored().theme).toBe('dark');
  });

  it('forgets the account on sign-out and keeps its theme for the page', async () => {
    onServer({ theme: 'dark', translateMode: 'two-way' });
    signedInAs('user-a');
    render();
    await settle();

    session.value = { data: null, status: 'unauthenticated' };
    render();
    await settle();
    expect(latest.synced).toBe(false);
    expect(latest.preferences.translateMode).toBe('one-way');
    expect(readCachedTheme()).toBe('dark');
    expect(accountPreferencesCache('user-a').read()).toBeNull();
  });

  it('removes the per-setting keys preferences used to live in', async () => {
    localStorage.setItem('chatofy.theme', 'dark');
    localStorage.setItem('chatofy.translate-mode', '/translate/two-way');
    signedInAs('user-a');
    render();
    await settle();
    expect(localStorage.getItem('chatofy.theme')).toBeNull();
    expect(localStorage.getItem('chatofy.translate-mode')).toBeNull();
    // Not imported: the account's own choice stands.
    expect(latest.preferences.theme).toBe('system');
  });
});
